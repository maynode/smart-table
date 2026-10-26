-- Grant zrg_dev access to the existing 10M demo sheet + add visible columns.

UPDATE workspaces
SET name = '千万行压测'
WHERE id = '72001328-af4e-42db-9862-722c90a4ea07';

UPDATE bases
SET name = '千万行演示 Base'
WHERE id = '4947e269-9569-4046-ba34-3bc7680ab10b';

UPDATE sheets
SET name = '1000万行表'
WHERE id = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2';

INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at)
SELECT gen_random_uuid(),
       '72001328-af4e-42db-9862-722c90a4ea07',
       '2dd34d08-5391-4ac8-8d56-03b76d1e21fc',
       'editor',
       NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM workspace_members
  WHERE workspace_id = '72001328-af4e-42db-9862-722c90a4ea07'
    AND user_id = '2dd34d08-5391-4ac8-8d56-03b76d1e21fc'
);

DELETE FROM fields
WHERE sheet_id = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2';

INSERT INTO fields (id, sheet_id, name, type, options, "order", required, hidden, created_at, updated_at)
VALUES
  (
    gen_random_uuid(),
    'c7832a8a-0f0d-45e9-92a1-2cae46563dd2',
    '标题',
    'text',
    '{"width": 220}'::jsonb,
    0,
    false,
    false,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'c7832a8a-0f0d-45e9-92a1-2cae46563dd2',
    '数量',
    'number',
    '{"width": 120}'::jsonb,
    1,
    false,
    false,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'c7832a8a-0f0d-45e9-92a1-2cae46563dd2',
    '状态',
    'select',
    '{"width": 120, "choices": [{"id": "todo", "name": "待处理", "color": "blue"}, {"id": "doing", "name": "进行中", "color": "orange"}, {"id": "done", "name": "已完成", "color": "green"}]}'::jsonb,
    2,
    false,
    false,
    NOW(),
    NOW()
  ),
  (
    gen_random_uuid(),
    'c7832a8a-0f0d-45e9-92a1-2cae46563dd2',
    '备注',
    'text',
    '{"width": 280}'::jsonb,
    3,
    false,
    false,
    NOW(),
    NOW()
  );

-- Fill a visible sample of rows (first 500 by id) so the viewport isn't blank.
WITH cols AS (
  SELECT
    MAX(id) FILTER (WHERE name = '标题') AS title_id,
    MAX(id) FILTER (WHERE name = '数量') AS qty_id,
    MAX(id) FILTER (WHERE name = '状态') AS status_id,
    MAX(id) FILTER (WHERE name = '备注') AS note_id
  FROM fields
  WHERE sheet_id = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2'
),
sample AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM records
  WHERE sheet_id = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2'
  ORDER BY id
  LIMIT 2000
)
UPDATE records r
SET
  cells = jsonb_build_object(
    c.title_id, '演示行 #' || s.rn,
    c.qty_id, (s.rn % 1000),
    c.status_id, (ARRAY['todo', 'doing', 'done'])[1 + (s.rn % 3)],
    c.note_id, '千万行压测样例'
  ),
  updated_at = NOW()
FROM sample s, cols c
WHERE r.id = s.id;

SELECT u.account, wm.role
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
WHERE wm.workspace_id = '72001328-af4e-42db-9862-722c90a4ea07';

SELECT COUNT(*) AS total_rows
FROM records
WHERE sheet_id = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2';

SELECT name, type FROM fields
WHERE sheet_id = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2'
ORDER BY "order";
