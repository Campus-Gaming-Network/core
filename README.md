### Migrations

Uses Soda tool from [Buffalo](https://gobuffalo.io/documentation/database/soda/)

Update database.yml file with your connection

`soda migrate [up|down]` to run migrations
`soda generate sql [migration_name]` to create new up/down migration