import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export type StorageDriver = 'filesystem' | 'minio';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.bin': 'application/octet-stream',
};

const SAFE_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));

@Injectable()
export class StorageService {
  readonly driver: StorageDriver;
  private readonly localDir: string;
  private readonly bucket: string;
  private readonly publicBase: string;
  private readonly s3: S3Client | null;

  constructor(private readonly config: ConfigService) {
    this.driver =
      this.config.get<string>('S3_DRIVER', 'filesystem') === 'minio'
        ? 'minio'
        : 'filesystem';
    this.localDir = this.config.get<string>('S3_LOCAL_DIR', '.data/s3');
    this.bucket = this.config.get<string>('S3_BUCKET', 'smart-table');
    this.publicBase = (
      this.config.get<string>('S3_PUBLIC_URL') ?? ''
    ).replace(/\/$/, '');

    this.s3 =
      this.driver === 'minio'
        ? new S3Client({
            region: this.config.get<string>('S3_REGION', 'us-east-1'),
            endpoint: this.config.get<string>('S3_ENDPOINT'),
            forcePathStyle: true,
            credentials: {
              accessKeyId: this.config.get<string>(
                'S3_ACCESS_KEY',
                'minioadmin',
              ),
              secretAccessKey: this.config.get<string>(
                'S3_SECRET_KEY',
                'minioadmin',
              ),
            },
          })
        : null;
  }

  async saveCover(buffer: Buffer, mimetype: string): Promise<string> {
    const extension =
      Object.entries(MIME_BY_EXT).find(
        ([, value]) => value === mimetype,
      )?.[0] ?? '.bin';
    const name = `${randomUUID()}${extension}`;
    const key = `covers/${name}`;

    if (this.driver === 'minio' && this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimetype,
        }),
      );
    } else {
      mkdirSync(join(this.localDir, 'covers'), { recursive: true });
      writeFileSync(join(this.localDir, key), buffer);
    }

    return `/files/${key}`;
  }

  /** 用户自定义头像（方图 JPEG/WebP/PNG） */
  async saveAvatar(buffer: Buffer, mimetype: string): Promise<string> {
    const extension =
      Object.entries(MIME_BY_EXT).find(
        ([, value]) => value === mimetype,
      )?.[0] ?? '.jpg';
    const name = `${randomUUID()}${extension}`;
    const key = `avatars/${name}`;

    if (this.driver === 'minio' && this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimetype,
        }),
      );
    } else {
      mkdirSync(join(this.localDir, 'avatars'), { recursive: true });
      writeFileSync(join(this.localDir, key), buffer);
    }

    return `/files/${key}`;
  }

  resolveAvatar(name: string): {
    path?: string;
    contentType?: string;
    redirectUrl?: string;
  } {
    if (!/^[A-Za-z0-9-]+\.(png|jpg|jpeg|webp)$/.test(name)) {
      throw new NotFoundException('头像不存在');
    }

    const key = `avatars/${name}`;
    if (this.driver === 'minio' && this.s3) {
      return { redirectUrl: `${this.publicBase}/${key}` };
    }

    const path = join(this.localDir, 'avatars', name);
    if (!existsSync(path)) {
      throw new NotFoundException('头像不存在');
    }
    const contentType =
      MIME_BY_EXT[extname(name).toLowerCase()] ?? 'image/jpeg';
    return { path, contentType };
  }

  async saveUpload(
    buffer: Buffer,
    mimetype: string,
    originalName: string,
  ): Promise<{
    key: string;
    url: string;
    name: string;
    mimetype: string;
    size: number;
  }> {
    const originalExt = extname(originalName).toLowerCase();
    const extension = SAFE_EXTENSIONS.has(originalExt)
      ? originalExt
      : Object.entries(MIME_BY_EXT).find(([, value]) => value === mimetype)?.[0] ??
        '.bin';
    const storedName = `${randomUUID()}${extension}`;
    const key = `uploads/${storedName}`;

    if (this.driver === 'minio' && this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimetype || MIME_BY_EXT[extension],
        }),
      );
    } else {
      mkdirSync(join(this.localDir, 'uploads'), { recursive: true });
      writeFileSync(join(this.localDir, key), buffer);
    }

    return {
      key,
      url: `/files/uploads/${storedName}`,
      name: originalName || storedName,
      mimetype:
        mimetype || MIME_BY_EXT[extension] || 'application/octet-stream',
      size: buffer.byteLength,
    };
  }

  resolveUpload(name: string): {
    path?: string;
    contentType?: string;
    redirectUrl?: string;
    downloadName: string;
  } {
    if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9]+)?$/.test(name)) {
      throw new NotFoundException('文件不存在');
    }
    const key = `uploads/${name}`;
    if (this.driver === 'minio' && this.s3) {
      return {
        redirectUrl: `${this.publicBase}/${key}`,
        downloadName: name,
      };
    }
    const path = join(this.localDir, 'uploads', name);
    if (!existsSync(path)) {
      throw new NotFoundException('文件不存在');
    }
    return {
      path,
      contentType:
        MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream',
      downloadName: name,
    };
  }

  resolveCover(name: string): {
    path?: string;
    contentType?: string;
    redirectUrl?: string;
  } {
    if (!/^[A-Za-z0-9-]+\.(png|jpg|jpeg|webp|gif|bin)$/.test(name)) {
      throw new NotFoundException('封面不存在');
    }

    const key = `covers/${name}`;
    if (this.driver === 'minio' && this.s3) {
      return { redirectUrl: `${this.publicBase}/${key}` };
    }

    const path = join(this.localDir, 'covers', name);
    if (!existsSync(path)) {
      throw new NotFoundException('封面不存在');
    }
    const contentType =
      MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream';
    return { path, contentType };
  }
}
