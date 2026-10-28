import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FeedbackStatus } from '@prisma/client';
import { isInstallAdmin } from '../auth/install-admin';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const MAX_CONTENT = 4_000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 800 * 1024;
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const IMAGE_URL_RE = /^\/files\/uploads\/[A-Za-z0-9-]+\.(png|jpe?g|webp)$/i;

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async uploadImage(
    _userId: string,
    buffer: Buffer,
    mimetype: string,
    originalName: string,
  ): Promise<{ url: string }> {
    if (!IMAGE_MIME.has(mimetype)) {
      throw new BadRequestException('仅支持 JPG / PNG / WebP');
    }
    if (!buffer.length) {
      throw new BadRequestException('未上传文件');
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new BadRequestException('图片过大，请压缩后再传（不超过 800KB）');
    }
    const saved = await this.storage.saveUpload(
      buffer,
      mimetype,
      originalName || 'feedback.jpg',
    );
    return { url: saved.url };
  }

  async create(
    userId: string,
    input: { content: string; pagePath?: string; imageUrls?: string[] },
  ) {
    const content = (input.content ?? '').trim();
    const imageUrls = this.normalizeImageUrls(input.imageUrls);
    if (!content && imageUrls.length === 0) {
      throw new BadRequestException('请填写反馈内容或上传图片');
    }
    if (content.length > MAX_CONTENT) {
      throw new BadRequestException(`反馈内容不超过 ${MAX_CONTENT} 字`);
    }
    const pagePath = input.pagePath?.trim().slice(0, 500) || null;
    const row = await this.prisma.feedback.create({
      data: { userId, content, pagePath, imageUrls },
    });
    return this.present(row, null);
  }

  async listForAdmin(
    userId: string,
    status?: FeedbackStatus | 'all',
  ) {
    await this.assertInstallAdmin(userId);
    const where =
      status && status !== 'all' ? { status } : undefined;
    const rows = await this.prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: {
          select: { id: true, account: true, name: true },
        },
      },
    });
    return {
      items: rows.map((row) =>
        this.present(row, {
          id: row.user.id,
          account: row.user.account,
          name: row.user.name,
        }),
      ),
    };
  }

  async updateStatus(
    adminUserId: string,
    feedbackId: string,
    status: FeedbackStatus,
  ) {
    await this.assertInstallAdmin(adminUserId);
    if (status !== 'open' && status !== 'done') {
      throw new BadRequestException('无效状态');
    }
    try {
      const row = await this.prisma.feedback.update({
        where: { id: feedbackId },
        data: { status },
        include: {
          user: {
            select: { id: true, account: true, name: true },
          },
        },
      });
      return this.present(row, {
        id: row.user.id,
        account: row.user.account,
        name: row.user.name,
      });
    } catch {
      throw new NotFoundException('反馈不存在');
    }
  }

  private normalizeImageUrls(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const urls = raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    if (urls.length > MAX_IMAGES) {
      throw new BadRequestException(`最多上传 ${MAX_IMAGES} 张图片`);
    }
    for (const url of urls) {
      if (!IMAGE_URL_RE.test(url)) {
        throw new BadRequestException('图片地址无效');
      }
    }
    return urls;
  }

  private async assertInstallAdmin(userId: string): Promise<void> {
    if (!(await isInstallAdmin(this.prisma, userId))) {
      throw new ForbiddenException({
        code: 'INSTALL_ADMIN_REQUIRED',
        message: '仅安装管理员可访问',
      });
    }
  }

  private present(
    row: {
      id: string;
      userId: string;
      content: string;
      pagePath: string | null;
      imageUrls: string[];
      status: FeedbackStatus;
      createdAt: Date;
      updatedAt: Date;
    },
    user: { id: string; account: string; name: string } | null,
  ) {
    return {
      id: row.id,
      userId: row.userId,
      content: row.content,
      pagePath: row.pagePath,
      imageUrls: row.imageUrls ?? [],
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user,
    };
  }
}
