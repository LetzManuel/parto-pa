-- Security advisor follow-up: fixed search_path on the sync trigger, PA functions only for signed-in users.
alter function public.pa_keep_newer() set search_path = public;

revoke execute on function public.ensure_personal_space() from public, anon;
revoke execute on function public.has_app(text) from public, anon;
revoke execute on function public.is_personal_space(uuid) from public, anon;
grant execute on function public.ensure_personal_space() to authenticated;
grant execute on function public.has_app(text) to authenticated;
grant execute on function public.is_personal_space(uuid) to authenticated;
