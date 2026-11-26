-- Parto PA: where an appointment takes place, so PA can work out when to leave (leave-by reminders).
-- Own events only; imported calendars stay on the device. Safe to run more than once.
alter table public.cal_event add column if not exists location text;
