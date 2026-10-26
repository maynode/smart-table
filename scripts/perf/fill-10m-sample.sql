WITH sample AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM records
  WHERE sheet_id = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2'
  ORDER BY id
  LIMIT 3000
)
UPDATE records r
SET
  cells = jsonb_build_object(
    'a8d78eae-5248-4fc3-8ead-e6277b345410', '演示行 #' || s.rn,
    'e5d91510-5f4a-4792-aedb-7fa133c94193', (s.rn % 1000),
    'd8463aa5-b3b7-4d8c-a631-60c3f7002566', (ARRAY['todo', 'doing', 'done'])[1 + (s.rn % 3)],
    '92603232-b796-44b7-bbfe-ec6c0fd683ee', '千万行压测样例'
  ),
  updated_at = NOW()
FROM sample s
WHERE r.id = s.id;

SELECT COUNT(*) FILTER (WHERE cells <> '{}'::jsonb) AS filled,
       COUNT(*) AS total
FROM records
WHERE sheet_id = 'c7832a8a-0f0d-45e9-92a1-2cae46563dd2';
