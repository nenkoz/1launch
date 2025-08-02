supabase start

# Reset local database (applies all migrations)

supabase db reset --local

# Apply new migrations to local

supabase migration up --local

# Check migration status

supabase migration list --local
