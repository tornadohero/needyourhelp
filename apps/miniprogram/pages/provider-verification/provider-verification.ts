import { ensureContext } from '../../src/app-context';
import type { MentorContext } from '../../src/app-context';
import type { VerificationTypeName } from '@mentor/api-contracts';
import { errorMessageOf } from '../../src/core/errors';
import type { VerificationRowView } from '../../src/core/provider-desk';
import { chooseDocument, putBinary, readFileBytes, showToast } from '../../src/platform/wechat';
import { myVerification } from '../../src/services/provider-desk';
import { submitEvidence } from '../../src/services/verification';

/**
 * 身份与学历验证（T032）— `specs/11` §Provider pages：Identity / Education
 * verification (FE-41).
 *
 * The document never travels through the platform's JSON API: the server signs a
 * short-lived URL, the bytes go straight to the object store, and the case is
 * submitted afterwards (`specs/13-security-spec.md` §File upload).
 *
 * The client sends no file hash — a WeChat mini program cannot compute SHA-256,
 * so the platform records it from the bytes it receives. Nothing is cached
 * locally and no document URL is kept after the upload (`specs/10`).
 */
interface ProviderVerificationData {
  loading: boolean;
  uploading: boolean;
  error: string;
  notice: string;
  cases: VerificationRowView[];
}

type PageInstance = WechatMiniprogram.Page.Instance<
  ProviderVerificationData,
  { context: MentorContext }
> & {
  context: MentorContext;
  load(): Promise<void>;
};

/** Which evidence a case of each type needs. */
const DOCUMENT_TYPE: Record<string, 'ID_CARD' | 'DIPLOMA'> = {
  IDENTITY: 'ID_CARD',
  EDUCATION: 'DIPLOMA',
};

const pageOptions = {
  data: {
    loading: true,
    uploading: false,
    error: '',
    notice: '',
    cases: [] as VerificationRowView[],
  },

  context: ensureContext(),

  onLoad(this: PageInstance): void {
    void this.load();
  },

  async load(this: PageInstance): Promise<void> {
    this.setData({ loading: true, error: '' });
    try {
      const cases = await myVerification(this.context);
      this.setData({ loading: false, cases });
    } catch (error) {
      this.setData({ loading: false, error: errorMessageOf(error) });
    }
  },

  async onUpload(this: PageInstance, event: WechatMiniprogram.TouchEvent): Promise<void> {
    const verificationType = String(event.currentTarget.dataset.type ?? '') as VerificationTypeName;
    const documentType = DOCUMENT_TYPE[verificationType];
    if (!documentType) {
      return;
    }

    const file = await chooseDocument();
    if (file === null) {
      return;
    }

    this.setData({ uploading: true, notice: '' });
    try {
      await submitEvidence(this.context, {
        verificationType,
        documentType,
        contentType: file.mimeType,
        byteSize: file.size,
        // The only platform-specific step: PUT the bytes at the signed URL.
        upload: async (target) => {
          const bytes = await readFileBytes(file.path);
          await putBinary(target.uploadUrl, bytes, target.headers);
        },
      });

      this.setData({ uploading: false });
      showToast('材料已提交。');
      await this.load();
    } catch (error) {
      // A refused content type, an expired URL or a rejected case: all shown.
      this.setData({ uploading: false, notice: errorMessageOf(error) });
      await this.load();
    }
  },

  async onRetry(this: PageInstance): Promise<void> {
    await this.load();
  },
};

Page<ProviderVerificationData, { context: MentorContext }>(
  pageOptions as unknown as WechatMiniprogram.Page.Options<
    ProviderVerificationData,
    { context: MentorContext }
  >,
);
