-- The Desktop billing role is provisioned outside Prisma and may not exist in
-- every development database. Apply the least-privilege analytics contract
-- when it is present; Desktop provisioning applies the same grants when the
-- role is created after this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'minaco_desktop_billing') THEN
    GRANT INSERT (
      event_id,
      user_id,
      event_name,
      context,
      params,
      attribution,
      include_session,
      occurred_at,
      delivery_status,
      last_error
    ) ON public.conversion_analytics_outbox TO minaco_desktop_billing;

    -- Required by ON CONFLICT (event_id) DO NOTHING; no event payload or user
    -- data can be read from the outbox through this grant.
    GRANT SELECT (event_id)
      ON public.conversion_analytics_outbox TO minaco_desktop_billing;

    GRANT SELECT (
      user_id,
      analytics_context,
      context_updated_at,
      first_touch,
      last_touch
    ) ON public.account_attribution TO minaco_desktop_billing;
  END IF;
END
$$;
