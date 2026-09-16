CREATE TABLE users
(
    id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL UNIQUE,
    phone text NOT NULL UNIQUE CHECK (phone ~ '^\+380\d{9}$'
) ,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products
(
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          text           NOT NULL,
    description   text           NOT NULL,
    price         numeric(12, 2) NOT NULL CHECK (price > 0),
    created_at    timestamptz    NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED
);

CREATE TABLE orders
(
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    bigint         NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    status     text           NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
    total      numeric(12, 2) NOT NULL CHECK (total >= 0),
    created_at timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE order_items
(
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id   bigint         NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id bigint         NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
    quantity   integer        NOT NULL CHECK (quantity > 0),
    unit_price numeric(12, 2) NOT NULL CHECK (unit_price > 0)
);