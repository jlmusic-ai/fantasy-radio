-- User deletion now runs through the authenticated commissioner API route,
-- which removes avatar files via the Storage API before deleting the auth user.
drop function if exists public.admin_delete_user(uuid);
