export type RuntimeEnv = Env & {
  TOKEN_SIGNING_SECRET?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  DUITKU_API_KEY?: string;
  DUITKU_MERCHANT_CODE?: string;
  DUITKU_API_BASE_URL?: string;
  DUITKU_CALLBACK_URL?: string;
  DUITKU_RETURN_URL?: string;
};
