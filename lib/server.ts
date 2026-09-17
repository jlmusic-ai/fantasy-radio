
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { CookieOptions } from '@supabase/ssr';

type CookieToSet = {
  name: string;
  value: string;
  options?: CookieOptions;
};

export async function serverClient() {
  const jar = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return jar.getAll();
        },

        setAll(items: CookieToSet[]) {
          try {
            items.forEach(({ name, value, options }) => {
              jar.set(name, value, options);
            });
          } catch {
            // Cookies cannot be modified in some server contexts.
          }
        },
      },
    }
  );
}

export async function commissioner() {
  const db = await serverClient();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    return { db, user: null, allowed: false };
  }

  const { data } = await db
    .from('profiles')
    .select('is_commissioner')
    .eq('id', user.id)
    .single();

  return {
    db,
    user,
    allowed: data?.is_commissioner === true,
  };
}
