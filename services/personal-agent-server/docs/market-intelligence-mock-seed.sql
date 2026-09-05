begin;

set local time zone 'UTC';

with mock_products (
  id, external_id, current_rank, name, slug, domain, category, launched_at,
  description, monthly_traffic, traffic_growth_pct, monthly_new_revenue_usd, revenue_growth_pct
) as (
  values
    ('mock_product_001', 'mock-ph-001', 1, 'NovaCanvas', 'nova-canvas', 'nova-canvas.example', 'Creative AI', '2026-01-08'::timestamptz, 'Turns product briefs into editable visual campaigns and launch assets.', 42800000::bigint, 82.4::numeric, 17200000::numeric, 67.6::numeric),
    ('mock_product_002', 'mock-ph-002', 2, 'OrbitOps', 'orbit-ops', 'orbit-ops.example', 'Productivity', '2026-01-13'::timestamptz, 'An AI operations workspace for recurring workflows, approvals, and handoffs.', 34100000, 44.8, 12900000, 44.4),
    ('mock_product_003', 'mock-ph-003', 3, 'CodeHarbor', 'code-harbor', 'code-harbor.example', 'AI Development', '2026-01-21'::timestamptz, 'A collaborative agent workspace for building, testing, and shipping applications.', 20100000, 38.8, 11400000, 35.3),
    ('mock_product_004', 'mock-ph-004', 4, 'SignalNest', 'signal-nest', 'signal-nest.example', 'Sales & GTM', '2026-01-29'::timestamptz, 'Combines account research, intent signals, and outbound personalization.', 18600000, 31.2, 8700000, 28.4),
    ('mock_product_005', 'mock-ph-005', 5, 'LumaDesk', 'luma-desk', 'luma-desk.example', 'Productivity', '2026-02-03'::timestamptz, 'A voice-first desk assistant for notes, follow-ups, and daily planning.', 15700000, 27.4, 7600000, 24.2),
    ('mock_product_006', 'mock-ph-006', 6, 'PixelMint', 'pixel-mint', 'pixel-mint.example', 'Creative AI', '2026-02-09'::timestamptz, 'Creates production-ready brand imagery with reusable visual controls.', 14900000, 25.8, 6900000, 22.5),
    ('mock_product_007', 'mock-ph-007', 7, 'PromptDock', 'prompt-dock', 'prompt-dock.example', 'AI Development', '2026-02-14'::timestamptz, 'Versioned prompt, tool, and evaluation management for product teams.', 13200000, 24.1, 6100000, 21.8),
    ('mock_product_008', 'mock-ph-008', 8, 'RelayFox', 'relay-fox', 'relay-fox.example', 'Sales & GTM', '2026-02-20'::timestamptz, 'Automates multi-channel lead routing and personalized follow-up sequences.', 11800000, 22.7, 5700000, 20.1),
    ('mock_product_009', 'mock-ph-009', 9, 'StoryForge', 'story-forge', 'story-forge.example', 'Creative AI', '2026-02-26'::timestamptz, 'A structured AI studio for scripts, storyboards, and short-form video.', 10500000, 20.6, 4900000, 18.8),
    ('mock_product_010', 'mock-ph-010', 10, 'MetricMuse', 'metric-muse', 'metric-muse.example', 'Sales & GTM', '2026-03-04'::timestamptz, 'Explains acquisition metrics and recommends the next growth experiment.', 9600000, 18.9, 4500000, 17.6),
    ('mock_product_011', 'mock-ph-011', 11, 'Briefly AI', 'briefly-ai', 'briefly-ai.example', 'Productivity', '2026-03-09'::timestamptz, 'Turns meetings, documents, and messages into concise decision briefs.', 8800000, 17.3, 4100000, 16.2),
    ('mock_product_012', 'mock-ph-012', 12, 'LeadSpring', 'lead-spring', 'lead-spring.example', 'Sales & GTM', '2026-03-15'::timestamptz, 'Finds emerging accounts and enriches them with actionable buying context.', 8200000, 16.2, 3900000, 15.1),
    ('mock_product_013', 'mock-ph-013', 13, 'NoteWave', 'note-wave', 'note-wave.example', 'Productivity', '2026-03-22'::timestamptz, 'A calm collaborative notebook with AI-assisted organization and recall.', 7500000, 15.4, 3400000, 14.8),
    ('mock_product_014', 'mock-ph-014', 14, 'FrameStack', 'frame-stack', 'frame-stack.example', 'Creative AI', '2026-03-29'::timestamptz, 'Builds consistent product videos from modular scenes and brand kits.', 6900000, 14.8, 3100000, 13.6),
    ('mock_product_015', 'mock-ph-015', 15, 'ScopeAI', 'scope-ai', 'scope-ai.example', 'AI Development', '2026-04-03'::timestamptz, 'Maps requirements into technical plans, milestones, and testable tasks.', 6400000, 13.9, 2900000, 12.7),
    ('mock_product_016', 'mock-ph-016', 16, 'Vaultly', 'vaultly', 'vaultly.example', 'Productivity', '2026-04-08'::timestamptz, 'A secure knowledge vault for personal research and company context.', 5900000, 13.1, 2600000, 11.9),
    ('mock_product_017', 'mock-ph-017', 17, 'Threadline', 'threadline', 'threadline.example', 'Productivity', '2026-04-14'::timestamptz, 'Connects conversations, decisions, and tasks into a searchable work graph.', 5500000, 12.4, 2400000, 11.2),
    ('mock_product_018', 'mock-ph-018', 18, 'QueryKit', 'query-kit', 'query-kit.example', 'AI Development', '2026-04-21'::timestamptz, 'A natural-language data workspace for reusable queries and dashboards.', 5100000, 11.8, 2200000, 10.6),
    ('mock_product_019', 'mock-ph-019', 19, 'MotionLab', 'motion-lab', 'motion-lab.example', 'Creative AI', '2026-04-27'::timestamptz, 'Generates controllable motion studies for ads, products, and social video.', 4800000, 10.9, 2000000, 9.8),
    ('mock_product_020', 'mock-ph-020', 20, 'EchoDesk', 'echo-desk', 'echo-desk.example', 'Productivity', '2026-05-02'::timestamptz, 'Captures calls and turns them into searchable notes and follow-up drafts.', 4400000, 10.1, 1900000, 9.1),
    ('mock_product_021', 'mock-ph-021', 21, 'FormPilot', 'form-pilot', 'form-pilot.example', 'Sales & GTM', '2026-05-08'::timestamptz, 'Builds adaptive lead forms that qualify and route prospects in real time.', 4100000, 9.6, 1750000, 8.7),
    ('mock_product_022', 'mock-ph-022', 22, 'DataSail', 'data-sail', 'data-sail.example', 'AI Development', '2026-05-14'::timestamptz, 'Moves operational data between tools with AI-generated transformations.', 3800000, 8.8, 1600000, 8.2),
    ('mock_product_023', 'mock-ph-023', 23, 'Reachly', 'reachly', 'reachly.example', 'Sales & GTM', '2026-05-19'::timestamptz, 'Plans creator outreach and tracks campaign conversations and outcomes.', 3500000, 8.1, 1480000, 7.5),
    ('mock_product_024', 'mock-ph-024', 24, 'FocusGrid', 'focus-grid', 'focus-grid.example', 'Productivity', '2026-05-25'::timestamptz, 'A visual priority system that protects focus time across team calendars.', 3200000, 7.4, 1360000, 6.9),
    ('mock_product_025', 'mock-ph-025', 25, 'LaunchLens', 'launch-lens', 'launch-lens.example', 'Sales & GTM', '2026-06-01'::timestamptz, 'Tracks launches, messaging changes, and growth signals across competitors.', 2950000, 6.8, 1240000, 6.1),
    ('mock_product_026', 'mock-ph-026', 26, 'SynthCall', 'synth-call', 'synth-call.example', 'Sales & GTM', '2026-06-07'::timestamptz, 'An AI calling workspace for qualification, summaries, and CRM updates.', 2700000, 6.1, 1160000, 5.5),
    ('mock_product_027', 'mock-ph-027', 27, 'MarketMap', 'market-map', 'market-map.example', 'Sales & GTM', '2026-06-13'::timestamptz, 'Maps competitors, positioning, pricing, and market movement in one view.', 2480000, 5.7, 1080000, 5.1),
    ('mock_product_028', 'mock-ph-028', 28, 'DevFoundry', 'dev-foundry', 'dev-foundry.example', 'AI Development', '2026-06-19'::timestamptz, 'A browser-based environment for agent-assisted prototyping and deployment.', 2240000, 5.2, 980000, 4.7),
    ('mock_product_029', 'mock-ph-029', 29, 'SlideCraft', 'slide-craft', 'slide-craft.example', 'Creative AI', '2026-06-25'::timestamptz, 'Transforms structured ideas into on-brand decks and interactive narratives.', 2010000, 4.8, 890000, 4.2),
    ('mock_product_030', 'mock-ph-030', 30, 'InboxPilot', 'inbox-pilot', 'inbox-pilot.example', 'Productivity', '2026-07-02'::timestamptz, 'Prioritizes messages and drafts replies using your communication preferences.', 1820000, 4.1, 810000, 3.6),
    ('mock_product_031', 'mock-ph-031', 31, 'ClipWave', 'clip-wave', 'clip-wave.example', 'Creative AI', '2026-07-08'::timestamptz, 'Finds high-signal moments in long video and turns them into social clips.', 1650000, 3.6, 730000, 3.1),
    ('mock_product_032', 'mock-ph-032', 32, 'SurveyFox', 'survey-fox', 'survey-fox.example', 'Productivity', '2026-07-14'::timestamptz, 'Runs adaptive customer interviews and synthesizes recurring themes.', 1480000, 2.9, 650000, 2.4),
    ('mock_product_033', 'mock-ph-033', 33, 'AgentDock', 'agent-dock', 'agent-dock.example', 'AI Development', '2026-07-21'::timestamptz, 'Monitors agent tools, permissions, costs, and production reliability.', 1320000, 1.8, 590000, 1.6),
    ('mock_product_034', 'mock-ph-034', 34, 'RankRiver', 'rank-river', 'rank-river.example', 'Sales & GTM', '2026-07-27'::timestamptz, 'Surfaces search opportunities and content movement across a market.', 1170000, 0.8, 510000, 0.4),
    ('mock_product_035', 'mock-ph-035', 35, 'PrismNote', 'prism-note', 'prism-note.example', 'Productivity', '2026-08-03'::timestamptz, 'A visual research notebook for comparing sources and evidence.', 980000, -2.4, 430000, -1.8),
    ('mock_product_036', 'mock-ph-036', 36, 'CanvasFlow', 'canvas-flow', 'canvas-flow.example', 'Creative AI', '2026-08-10'::timestamptz, 'A lightweight creative workflow for turning references into reusable assets.', 840000, -4.8, 370000, -3.1)
)
insert into market_intelligence.products (
  id, external_source, external_id, slug, name, tagline, description, domain, website_url,
  category, topics, launched_at, current_rank, monthly_traffic, traffic_growth_pct,
  monthly_new_revenue_usd, revenue_growth_pct, data_confidence, is_mock, metrics_updated_at,
  created_at, updated_at
)
select
  id, 'mock_product_hunt', external_id, slug, name, 'Mock Product Hunt launch', description,
  domain, 'https://' || domain, category, array[category, 'Mock data'], launched_at,
  current_rank, monthly_traffic, traffic_growth_pct, monthly_new_revenue_usd,
  revenue_growth_pct, 'mock', true, '2026-09-01T00:00:00Z'::timestamptz, now(), now()
from mock_products
on conflict (external_source, external_id) do update set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  domain = excluded.domain,
  website_url = excluded.website_url,
  category = excluded.category,
  topics = excluded.topics,
  launched_at = excluded.launched_at,
  current_rank = excluded.current_rank,
  monthly_traffic = excluded.monthly_traffic,
  traffic_growth_pct = excluded.traffic_growth_pct,
  monthly_new_revenue_usd = excluded.monthly_new_revenue_usd,
  revenue_growth_pct = excluded.revenue_growth_pct,
  data_confidence = excluded.data_confidence,
  is_mock = excluded.is_mock,
  metrics_updated_at = excluded.metrics_updated_at,
  updated_at = now();

insert into market_intelligence.product_launches (
  id, product_id, source, external_id, launched_at, votes_count, comments_count, is_mock, created_at, updated_at
)
select
  'mock_launch_' || lpad(p.current_rank::text, 3, '0'), p.id, p.external_source, p.external_id,
  p.launched_at, 1800 - p.current_rank * 31, 260 - p.current_rank * 4, true, now(), now()
from market_intelligence.products p
where p.external_source = 'mock_product_hunt'
on conflict (source, external_id) do update set
  product_id = excluded.product_id,
  launched_at = excluded.launched_at,
  votes_count = excluded.votes_count,
  comments_count = excluded.comments_count,
  is_mock = true,
  updated_at = now();

insert into market_intelligence.product_monthly_metrics (
  product_id, month, traffic_visits, estimated_monthly_users, estimated_new_revenue_usd,
  revenue_low_usd, revenue_high_usd, traffic_source, revenue_source, confidence,
  method_version, is_mock, observed_at, created_at, updated_at
)
select
  p.id,
  (date '2026-03-01' + make_interval(months => series.month_index))::date,
  round(
    p.monthly_traffic::numeric * (
      (100::numeric / (100 + p.traffic_growth_pct)) +
      (1 - (100::numeric / (100 + p.traffic_growth_pct))) * series.month_index / 5
    )
  )::bigint,
  round(
    p.monthly_traffic::numeric * 0.37 * (
      (100::numeric / (100 + p.traffic_growth_pct)) +
      (1 - (100::numeric / (100 + p.traffic_growth_pct))) * series.month_index / 5
    )
  )::bigint,
  round(
    p.monthly_new_revenue_usd * (
      (100::numeric / (100 + p.revenue_growth_pct)) +
      (1 - (100::numeric / (100 + p.revenue_growth_pct))) * series.month_index / 5
    ),
    2
  ),
  round(
    p.monthly_new_revenue_usd * 0.72 * (
      (100::numeric / (100 + p.revenue_growth_pct)) +
      (1 - (100::numeric / (100 + p.revenue_growth_pct))) * series.month_index / 5
    ),
    2
  ),
  round(
    p.monthly_new_revenue_usd * 1.28 * (
      (100::numeric / (100 + p.revenue_growth_pct)) +
      (1 - (100::numeric / (100 + p.revenue_growth_pct))) * series.month_index / 5
    ),
    2
  ),
  'mock_similarweb', 'mock_revenue_model', 'mock', 'mock-v1', true,
  '2026-09-01T00:00:00Z'::timestamptz, now(), now()
from market_intelligence.products p
cross join generate_series(0, 5) as series(month_index)
where p.external_source = 'mock_product_hunt'
on conflict (product_id, month) do update set
  traffic_visits = excluded.traffic_visits,
  estimated_monthly_users = excluded.estimated_monthly_users,
  estimated_new_revenue_usd = excluded.estimated_new_revenue_usd,
  revenue_low_usd = excluded.revenue_low_usd,
  revenue_high_usd = excluded.revenue_high_usd,
  traffic_source = excluded.traffic_source,
  revenue_source = excluded.revenue_source,
  confidence = excluded.confidence,
  method_version = excluded.method_version,
  is_mock = true,
  observed_at = excluded.observed_at,
  updated_at = now();

insert into market_intelligence.sync_runs (
  id, source, status, item_count, is_mock, metadata, started_at, completed_at
)
values (
  'mock_seed_20260905', 'mock_product_hunt', 'completed', 36, true,
  '{"trafficSource":"mock_similarweb","revenueSource":"mock_revenue_model","months":6,"version":"mock-v1"}'::jsonb,
  now(), now()
)
on conflict (id) do update set
  status = excluded.status,
  item_count = excluded.item_count,
  metadata = excluded.metadata,
  completed_at = now();

commit;
