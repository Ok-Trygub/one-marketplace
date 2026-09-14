SELECT o.id, o.status, o.total, o.created_at, count(i.id) AS items
FROM orders AS o
JOIN order_items AS i ON i.order_id = o.id
WHERE o.user_id = 1234
  AND o.created_at >= now() - interval '90 days'
GROUP BY o.id
ORDER BY o.created_at DESC
