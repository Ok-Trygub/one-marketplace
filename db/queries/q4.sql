SELECT id, name, ts_rank(search_vector, plainto_tsquery('simple', 'бездротові навушники')) AS rank
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'бездротові навушники')
ORDER BY rank DESC, id
    LIMIT 20