-- Per-app iframe sandbox and permission policy columns
-- NULL = restrictive default (allow-scripts allow-forms). Elevated permissions must be explicitly set.
ALTER TABLE app_registrations
  ADD COLUMN IF NOT EXISTS sandbox_permissions text,
  ADD COLUMN IF NOT EXISTS permission_policy text;

-- Spotify requires elevated permissions for Web Playback SDK (DRM/EME, OAuth popups)
UPDATE app_registrations
  SET sandbox_permissions = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin',
      permission_policy = 'encrypted-media; autoplay'
  WHERE slug = 'spotify';
