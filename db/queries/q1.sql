SELECT id, status, total, created_at
FROM orders
WHERE user_id = 1234
  AND created_at >= now() - interval '90 days'
ORDER BY created_at DESC