-- Phase 1B: curated launch catalog. Games remain read-only to end users.

INSERT INTO games (name, slug)
VALUES
    ('Rocket League', 'rocket-league'),
    ('Valorant', 'valorant'),
    ('League of Legends', 'league-of-legends'),
    ('Overwatch 2', 'overwatch-2'),
    ('Super Smash Bros. Ultimate', 'super-smash-bros-ultimate'),
    ('CSGO', 'csgo')
ON CONFLICT (slug) DO NOTHING;
