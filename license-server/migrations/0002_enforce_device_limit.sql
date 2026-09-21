CREATE TRIGGER enforce_two_active_devices_on_insert
BEFORE INSERT ON devices
WHEN NEW.revoked_at IS NULL AND (
  SELECT COUNT(*) FROM devices
  WHERE user_id = NEW.user_id AND revoked_at IS NULL
) >= 2
BEGIN
  SELECT RAISE(ABORT, 'device_limit_reached');
END;

CREATE TRIGGER enforce_two_active_devices_on_reactivation
BEFORE UPDATE OF revoked_at ON devices
WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL AND (
  SELECT COUNT(*) FROM devices
  WHERE user_id = NEW.user_id AND revoked_at IS NULL AND id <> NEW.id
) >= 2
BEGIN
  SELECT RAISE(ABORT, 'device_limit_reached');
END;

