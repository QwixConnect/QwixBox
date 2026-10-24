-- Only apply to the dedicated disposable qwixbox_sip_test database.
DO $$ BEGIN
  IF current_database() <> 'qwixbox_sip_test' THEN
    RAISE EXCEPTION 'This fixture requires the dedicated disposable qwixbox_sip_test database';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS version (table_name text PRIMARY KEY, table_version integer NOT NULL);
INSERT INTO version VALUES ('sip_auth_fixture', 7) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sip_auth_fixture (
  username text, domain text, password text NOT NULL, ha1 text, ha1b text
);
TRUNCATE sip_auth_fixture;
INSERT INTO sip_auth_fixture
SELECT '101', domain, '', md5('101:' || domain || ':fixture-secret-' || domain),
       md5('101@' || domain || ':' || domain || ':fixture-secret-' || domain)
FROM (VALUES ('a.test'), ('b.test')) AS domains(domain);
