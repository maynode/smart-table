import type { Page } from '@playwright/test';

export type E2eFace =
  | 'data'
  | 'form'
  | 'automation'
  | 'dashboard'
  | 'analysis';

/** Face-first IA: sidebar sections only show under the matching face tab. */
export async function selectFace(page: Page, face: E2eFace): Promise<void> {
  await page.getByTestId(`face-tab-${face}`).click();
}
