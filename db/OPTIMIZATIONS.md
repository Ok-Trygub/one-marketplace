# Query optimizations

## Setup

PostgreSQL 17 in Docker. Data from `db/seed.sql`: 5,000 users, 126,000 products, 200,000 orders,
about 400,000 order items. Order statuses are skewed: ~80% `paid`, 15% `pending`, 5% `cancelled`.
Product names and descriptions are in Ukrainian; `products.search_vector` is a stored generated
`tsvector` column built with the `simple` configuration.

Each query was measured with `EXPLAIN (ANALYZE, BUFFERS)` on a fresh volume: schema, seed, plans
"before", then `db/indexes.sql`, `ANALYZE`, plans "after". For q1 the "after" plan is the second
run; for q2, q3 and q4 it is the first run after index creation, so `read=` shows pages that came
from disk.

```sh
(echo "EXPLAIN (ANALYZE, BUFFERS)"; cat db/queries/q1.sql) | docker compose exec -T postgres psql -U app_user -d marketplace
```

`Buffers: shared hit` is the number of 8 KB pages found in memory, `read` the pages taken from disk.
`Execution Time` excludes planning.

## q1. Customer order history for the last 90 days with the number of lines

```sql
SELECT o.id, o.status, o.total, o.created_at, count(i.id) AS items
FROM orders AS o
JOIN order_items AS i ON i.order_id = o.id
WHERE o.user_id = 1234
  AND o.created_at >= now() - interval '90 days'
GROUP BY o.id
ORDER BY o.created_at DESC
```

Problem: `orders` was scanned in full to find the customer's rows, and `order_items` was hashed in
full to join them, two parallel sequential scans for a handful of orders.

Indexes: composite `(user_id, created_at DESC)` on `orders` and a plain index on
`order_items.order_id`. The first finds the customer's orders inside the period already ordered by
date; the second lets the join fetch the lines of each order directly instead of hashing the whole
table. `order_items.order_id` is also the column the `ON DELETE CASCADE` check reads when an order
is deleted.

```sql
CREATE INDEX orders_user_id_created_at_idx ON orders (user_id, created_at DESC);
CREATE INDEX order_items_order_id_idx ON order_items (order_id);
```

Before:

```
 Sort  (cost=11296.04..11296.05 rows=5 width=35) (actual time=6.288..7.918 rows=0 loops=1)
   Sort Key: o.created_at DESC
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=3296
   ->  Finalize GroupAggregate  (cost=11294.90..11295.98 rows=5 width=35) (actual time=6.279..7.908 rows=0 loops=1)
         Group Key: o.id
         Buffers: shared hit=3293
         ->  Gather Merge  (cost=11294.90..11295.89 rows=8 width=35) (actual time=6.278..7.907 rows=0 loops=1)
               Workers Planned: 2
               Workers Launched: 2
               Buffers: shared hit=3293
               ->  Partial GroupAggregate  (cost=10294.87..10294.94 rows=4 width=35) (actual time=4.295..4.296 rows=0 loops=3)
                     Group Key: o.id
                     Buffers: shared hit=3293
                     ->  Sort  (cost=10294.87..10294.88 rows=4 width=35) (actual time=4.294..4.295 rows=0 loops=3)
                           Sort Key: o.id
                           Sort Method: quicksort  Memory: 25kB
                           Buffers: shared hit=3293
                           Worker 0:  Sort Method: quicksort  Memory: 25kB
                           Worker 1:  Sort Method: quicksort  Memory: 25kB
                           ->  Parallel Hash Join  (cost=4861.69..10294.83 rows=4 width=35) (actual time=4.258..4.259 rows=0 loops=3)
                                 Hash Cond: (i.order_id = o.id)
                                 Buffers: shared hit=3219
                                 ->  Parallel Seq Scan on order_items i  (cost=0.00..4996.05 rows=166505 width=16) (never executed)
                                 ->  Parallel Hash  (cost=4861.67..4861.67 rows=2 width=27) (actual time=4.186..4.186 rows=0 loops=3)
                                       Buckets: 1024  Batches: 1  Memory Usage: 0kB
                                       Buffers: shared hit=3195
                                       ->  Parallel Seq Scan on orders o  (cost=0.00..4861.67 rows=2 width=27) (actual time=4.146..4.146 rows=0 loops=3)
                                             Filter: ((user_id = 1234) AND (created_at >= (now() - '90 days'::interval)))
                                             Rows Removed by Filter: 66667
                                             Buffers: shared hit=3195
 Planning:
   Buffers: shared hit=151
 Planning Time: 0.455 ms
 Execution Time: 7.994 ms
```

After:

```
 Sort  (cost=86.38..86.39 rows=5 width=35) (actual time=0.030..0.031 rows=0 loops=1)
   Sort Key: o.created_at DESC
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=12
   ->  GroupAggregate  (cost=86.19..86.32 rows=5 width=35) (actual time=0.023..0.023 rows=0 loops=1)
         Group Key: o.id
         Buffers: shared hit=9
         ->  Sort  (cost=86.19..86.22 rows=10 width=35) (actual time=0.022..0.023 rows=0 loops=1)
               Sort Key: o.id
               Sort Method: quicksort  Memory: 25kB
               Buffers: shared hit=9
               ->  Nested Loop  (cost=4.90..86.03 rows=10 width=35) (actual time=0.015..0.016 rows=0 loops=1)
                     Buffers: shared hit=6
                     ->  Bitmap Heap Scan on orders o  (cost=4.48..23.98 rows=5 width=27) (actual time=0.015..0.015 rows=0 loops=1)
                           Recheck Cond: ((user_id = 1234) AND (created_at >= (now() - '90 days'::interval)))
                           Buffers: shared hit=6
                           ->  Bitmap Index Scan on orders_user_id_created_at_idx  (cost=0.00..4.47 rows=5 width=0) (actual time=0.013..0.013 rows=0 loops=1)
                                 Index Cond: ((user_id = 1234) AND (created_at >= (now() - '90 days'::interval)))
                                 Buffers: shared hit=6
                     ->  Index Scan using order_items_order_id_idx on order_items i  (cost=0.42..12.39 rows=2 width=16) (never executed)
                           Index Cond: (order_id = o.id)
 Planning:
   Buffers: shared hit=217
 Planning Time: 0.391 ms
 Execution Time: 0.058 ms
```

Result: both `Parallel Seq Scan` nodes, the `Parallel Hash Join` and `Gather Merge` are gone. The
customer's orders come from `Bitmap Index Scan on orders_user_id_created_at_idx`, and the join is a
`Nested Loop` with `Index Scan using order_items_order_id_idx` per order. 12 pages instead of 3,296,
0.06 ms instead of 8.0 ms. In this seed customer 1234 had no orders in the last 90 days, which is
why `rows=0`; the plan shape is the same for a customer with orders, only the nested loop runs a few
times.

## q2. Latest cancelled orders

```sql
SELECT id, user_id, total, created_at
FROM orders
WHERE status = 'cancelled'
ORDER BY created_at DESC
LIMIT 50
```

Problem: the whole table was scanned and ~10,000 cancelled rows sorted to return 50.

Index: partial, only rows with `status = 'cancelled'`, ordered by date. It holds ~5% of the table,
and `LIMIT 50` reads the first 50 entries with no sort step.

```sql
CREATE INDEX orders_cancelled_created_at_idx ON orders (created_at DESC) WHERE status = 'cancelled';
```

Before:

```
 Limit  (cost=5372.89..5378.72 rows=50 width=30) (actual time=42.878..47.539 rows=50 loops=1)
   Buffers: shared hit=3269
   ->  Gather Merge  (cost=5372.89..6329.62 rows=8200 width=30) (actual time=42.877..47.535 rows=50 loops=1)
         Workers Planned: 2
         Workers Launched: 2
         Buffers: shared hit=3269
         ->  Sort  (cost=4372.87..4383.12 rows=4100 width=30) (actual time=34.990..34.992 rows=37 loops=3)
               Sort Key: created_at DESC
               Sort Method: top-N heapsort  Memory: 30kB
               Buffers: shared hit=3269
               Worker 0:  Sort Method: top-N heapsort  Memory: 30kB
               Worker 1:  Sort Method: top-N heapsort  Memory: 30kB
               ->  Parallel Seq Scan on orders  (cost=0.00..4236.67 rows=4100 width=30) (actual time=11.016..34.222 rows=3376 loops=3)
                     Filter: (status = 'cancelled'::text)
                     Rows Removed by Filter: 63291
                     Buffers: shared hit=3195
 Planning:
   Buffers: shared hit=92
 Planning Time: 1.903 ms
 Execution Time: 48.148 ms
```

After:

```
 Limit  (cost=0.29..65.97 rows=50 width=30) (actual time=0.164..2.552 rows=50 loops=1)
   Buffers: shared hit=50 read=2
   ->  Index Scan using orders_cancelled_created_at_idx on orders  (cost=0.29..13048.70 rows=9933 width=30) (actual time=0.164..2.547 rows=50 loops=1)
         Buffers: shared hit=50 read=2
 Planning:
   Buffers: shared hit=125
 Planning Time: 0.687 ms
 Execution Time: 2.576 ms
```

Result: the plan is `Index Scan using orders_cancelled_created_at_idx`; `Sort`, `Gather Merge` and
the parallel workers are gone because the partial index already stores the rows in the requested
order. 52 pages instead of 3,195, 2.6 ms instead of 48.1 ms.

## q3. Case-insensitive user lookup by email

```sql
SELECT id, name, phone
FROM users
WHERE lower(email) = lower('Olena.Shevchenko@gmail.com')
```

Problem: a plain index on `email` cannot serve `lower(email)`, so all 5,000 rows were scanned and
`lower()` computed for each.

Index: expression index on `lower(email)`, so the computed value is stored and matched directly.

```sql
CREATE INDEX users_lower_email_idx ON users (lower(email));
```

Before:

```
 Seq Scan on users  (cost=0.00..148.00 rows=25 width=51) (actual time=0.390..3.575 rows=1 loops=1)
   Filter: (lower(email) = 'olena.shevchenko@gmail.com'::text)
   Rows Removed by Filter: 4999
   Buffers: shared hit=73
 Planning:
   Buffers: shared hit=96
 Planning Time: 2.697 ms
 Execution Time: 3.659 ms
```

After:

```
 Index Scan using users_lower_email_idx on users  (cost=0.28..8.30 rows=1 width=51) (actual time=0.582..0.583 rows=1 loops=1)
   Index Cond: (lower(email) = 'olena.shevchenko@gmail.com'::text)
   Buffers: shared hit=1 read=2
 Planning:
   Buffers: shared hit=115 read=1
 Planning Time: 1.194 ms
 Execution Time: 0.629 ms
```

Result: `Seq Scan` with 4,999 rows removed by the filter is replaced by
`Index Scan using users_lower_email_idx` that goes straight to the one matching row.
3 pages instead of 73, 0.63 ms instead of 3.7 ms.

## q4. Full-text search in the catalogue

```sql
SELECT id, name, ts_rank(search_vector, plainto_tsquery('simple', 'бездротові навушники')) AS rank
FROM products
WHERE search_vector @@ plainto_tsquery('simple', 'бездротові навушники')
ORDER BY rank DESC, id
LIMIT 20
```

The query matches 3,600 of 126,000 products (2.9%).

Problem: without an index the `@@` operator is evaluated against every stored vector, so the whole
`products` table is read and 122,400 rows are removed by the filter.

Index: GIN on the stored `tsvector` column. GIN is an inverted index: for every word it keeps the
list of rows containing it, so the two query words are resolved to two row lists and intersected
without touching the table.

```sql
CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);
```

Before:

```
 Limit  (cost=13772.91..13772.96 rows=20 width=47) (actual time=175.275..175.277 rows=20 loops=1)
   Buffers: shared hit=7511 read=4690
   ->  Sort  (cost=13772.91..13773.16 rows=100 width=47) (actual time=175.274..175.275 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''бездротові'' & ''навушники'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 26kB
         Buffers: shared hit=7511 read=4690
         ->  Seq Scan on products  (cost=0.00..13770.25 rows=100 width=47) (actual time=3.722..174.832 rows=3600 loops=1)
               Filter: (search_vector @@ '''бездротові'' & ''навушники'''::tsquery)
               Rows Removed by Filter: 122400
               Buffers: shared hit=7505 read=4690
 Planning:
   Buffers: shared hit=126
 Planning Time: 2.514 ms
 Execution Time: 175.314 ms
```

After:

```
 Limit  (cost=399.96..400.01 rows=20 width=47) (actual time=23.731..23.733 rows=20 loops=1)
   Buffers: shared hit=309 read=232
   ->  Sort  (cost=399.96..400.20 rows=98 width=47) (actual time=23.729..23.730 rows=20 loops=1)
         Sort Key: (ts_rank(search_vector, '''бездротові'' & ''навушники'''::tsquery)) DESC, id
         Sort Method: top-N heapsort  Memory: 26kB
         Buffers: shared hit=309 read=232
         ->  Bitmap Heap Scan on products  (cost=30.23..397.35 rows=98 width=47) (actual time=1.028..22.853 rows=3600 loops=1)
               Recheck Cond: (search_vector @@ '''бездротові'' & ''навушники'''::tsquery)
               Heap Blocks: exact=528
               Buffers: shared hit=303 read=232
               ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.21 rows=98 width=0) (actual time=0.673..0.673 rows=3600 loops=1)
                     Index Cond: (search_vector @@ '''бездротові'' & ''навушники'''::tsquery)
                     Buffers: shared hit=7
 Planning:
   Buffers: shared hit=150 read=1
 Planning Time: 3.737 ms
 Execution Time: 23.930 ms
```

Result: `Seq Scan on products` is replaced by `Bitmap Index Scan on idx_products_search_vector`,
which finds all 3,600 matches from 7 index pages; the table is then read only on the 528 pages that
hold those rows (`Heap Blocks: exact=528`). 541 pages instead of 12,195, 23.9 ms instead of 175.3 ms.
The `Sort` node stays because `ts_rank` is computed per matched row and cannot come from the index.

Cost of the stored `tsvector` column: `pg_total_relation_size('products')` is 98 MB for 126,000 rows
with the column, roughly twice the size of the same table without it, and every `INSERT` into
`products` also parses the text.

## Foreign key indexes

PostgreSQL creates an index for the referenced side of a foreign key (`PRIMARY KEY`) but not for the
referencing column. Without an index on `order_items.order_id`, every `DELETE FROM orders` scans the
whole `order_items` table to run the `ON DELETE CASCADE`, and every join from orders to their lines
hashes the whole table; without an index on `order_items.product_id`, every `DELETE FROM products`
scans it to enforce `ON DELETE RESTRICT`. Both indexes are therefore part of `db/indexes.sql`:

```sql
CREATE INDEX order_items_order_id_idx ON order_items (order_id);
CREATE INDEX order_items_product_id_idx ON order_items (product_id);
```

`order_items_order_id_idx` is used by q1 and by the cascade check. `order_items_product_id_idx`
serves only the `RESTRICT` check and product-level reports, so none of q1–q4 touches it and it shows
`idx_scan = 0` in `pg_stat_user_indexes` after the four queries; it is kept on purpose as a
foreign-key index, not as a query index. With the index, `DELETE FROM orders WHERE id = 777` runs the
cascade trigger in 0.26 ms instead of scanning 400,000 lines.

## Морфологія

Two forms of the same Ukrainian word, nominative and genitive plural, against the same catalogue:

```sql
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'навушники');   -- 3600
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'навушників');  -- 0
```

`навушники` matches 3600 products, `навушників` matches 0. The `simple` configuration only lowercases
and splits text into tokens, it has no stemming, so the two forms are two unrelated words for the
index, and `SELECT cfgname FROM pg_ts_config` shows no Ukrainian configuration in this build.
Switching to a configuration of another language from that list would apply that language's suffix
rules to Ukrainian words and produce wrong merges rather than a fix; real Ukrainian search needs a
Hunspell-based dictionary and a custom text search configuration, or an external search engine.

## Summary

| Query | Index | Type | Pages before → after | Time before → after |
|---|---|---|---|---|
| q1 | `orders_user_id_created_at_idx`, `order_items_order_id_idx` | composite B-tree, B-tree on FK | 3,296 → 12 | 8.0 ms → 0.06 ms |
| q2 | `orders_cancelled_created_at_idx` | partial B-tree | 3,195 → 52 | 48.1 ms → 2.6 ms |
| q3 | `users_lower_email_idx` | expression B-tree | 73 → 3 | 3.7 ms → 0.63 ms |
| q4 | `idx_products_search_vector` | GIN on tsvector | 12,195 → 541 | 175.3 ms → 23.9 ms |

`order_items_product_id_idx` is the only index not exercised by q1–q4, see "Foreign key indexes".
