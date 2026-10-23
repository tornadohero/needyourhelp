-- The document hash is recorded by the server when the object is uploaded, not
-- asserted by the client: a WeChat mini program cannot compute SHA-256, so the
-- column is empty between "upload URL issued" and "upload finished".
ALTER TABLE "verification_documents" ALTER COLUMN "file_hash" DROP NOT NULL;
