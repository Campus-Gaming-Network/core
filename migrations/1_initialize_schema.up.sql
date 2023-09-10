CREATE TABLE users (
                       id SERIAL PRIMARY KEY,
                       full_name VARCHAR(255) NOT NULL,
                       email VARCHAR(255) NOT NULL UNIQUE,
                       gravatar VARCHAR(255) NOT NULL,
                       password_hash TEXT NOT NULL,
                       created_at TIMESTAMPTZ DEFAULT NOW(),
                       updated_at TIMESTAMPTZ DEFAULT NOW(),
                       deleted_at TIMESTAMPTZ
);

CREATE TABLE events (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        title VARCHAR(255) NOT NULL,
                        description TEXT NOT NULL,
                        start_date_time TIMESTAMPTZ NOT NULL,
                        end_date_time TIMESTAMPTZ NOT NULL,
                        is_online INTEGER DEFAULT 0 NOT NULL,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        deleted_at TIMESTAMPTZ
);

CREATE TABLE schools (
                         id SERIAL PRIMARY KEY,
                         name VARCHAR(255) NOT NULL,
                         handle VARCHAR(255) NOT NULL,
                         created_at TIMESTAMPTZ DEFAULT NOW(),
                         updated_at TIMESTAMPTZ DEFAULT NOW(),
                         deleted_at TIMESTAMPTZ
);

CREATE TABLE school_users (
                              id SERIAL PRIMARY KEY,
                              user_id INTEGER NOT NULL,
                              school_id INTEGER NOT NULL,
                              created_at TIMESTAMPTZ DEFAULT NOW(),
                              updated_at TIMESTAMPTZ DEFAULT NOW(),
                              deleted_at TIMESTAMPTZ
);

CREATE TABLE participants (
                              id SERIAL PRIMARY KEY,
                              user_id INTEGER NOT NULL,
                              event_id INTEGER NOT NULL,
                              response INTEGER DEFAULT 1 NOT NULL,
                              created_at TIMESTAMPTZ DEFAULT NOW(),
                              updated_at TIMESTAMPTZ DEFAULT NOW(),
                              deleted_at TIMESTAMPTZ
);

-- Foreign Key Constraints
ALTER TABLE events ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE school_users ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE school_users ADD CONSTRAINT fk_school_id FOREIGN KEY (school_id) REFERENCES schools (id);
ALTER TABLE participants ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE participants ADD CONSTRAINT fk_event_id FOREIGN KEY (event_id) REFERENCES events (id);
