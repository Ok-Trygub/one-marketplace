CREATE INDEX orders_user_id_created_at_idx
  ON orders (user_id, created_at DESC);

CREATE INDEX orders_cancelled_created_at_idx
  ON orders (created_at DESC)
  WHERE status = 'cancelled';

CREATE INDEX users_lower_email_idx
  ON users (lower(email));

CREATE INDEX idx_products_search_vector
  ON products USING GIN (search_vector);

CREATE INDEX order_items_order_id_idx
  ON order_items (order_id);

CREATE INDEX order_items_product_id_idx
  ON order_items (product_id);
