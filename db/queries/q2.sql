SELECT id, user_id, total, created_at
FROM orders
WHERE status = 'cancelled'
ORDER BY created_at DESC
    LIMIT 50