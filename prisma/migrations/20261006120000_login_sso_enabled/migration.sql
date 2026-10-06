-- Microsoft becomes one selectable SSO provider: carry the beta.3 Microsoft login switch over to the
-- provider-neutral SSO switch so existing Entra installations keep their behaviour. The old row is
-- left in place so a rollback to beta.3 still reads its original value.
INSERT INTO "app_settings" ("id", "key", "value", "updated_at")
SELECT md5('app_settings:login_sso_enabled'), 'login_sso_enabled', "value", CURRENT_TIMESTAMP
FROM "app_settings"
WHERE "key" = 'login_microsoft_enabled'
ON CONFLICT ("key") DO NOTHING;
