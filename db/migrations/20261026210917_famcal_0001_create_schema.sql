create schema if not exists famcal;

comment on schema famcal is 'Family Calendar Display (github.com/aqnet/famcal). Server-only: not exposed to the Data API; RLS on every table, no anon/authenticated policies.';

-- Only the server (service_role) may use this schema.
revoke all on schema famcal from public, anon, authenticated;
grant usage on schema famcal to service_role;

-- Future objects created in famcal: no access for anon/authenticated, full access for service_role.
alter default privileges in schema famcal revoke all on tables from public, anon, authenticated;
alter default privileges in schema famcal revoke all on sequences from public, anon, authenticated;
alter default privileges in schema famcal revoke all on functions from public, anon, authenticated;
alter default privileges in schema famcal grant all on tables to service_role;
alter default privileges in schema famcal grant all on sequences to service_role;
alter default privileges in schema famcal grant execute on functions to service_role;
