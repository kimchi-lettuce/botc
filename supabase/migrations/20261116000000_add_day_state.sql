-- Day phase: one JSONB document per game holding today's nominations and the
-- frozen result once the Storyteller ends the day.
--
-- The vote arithmetic itself lives in TypeScript (src/lib/server/day.ts ->
-- src/lib/engine/vote.ts), so this migration adds storage only and threads the
-- document through the existing storyteller update RPC. Nothing here knows the
-- rules of the game.

alter table public.games
  add column if not exists day_state jsonb not null
    default '{"dayNumber":1,"nominations":[],"closed":null}'::jsonb;

-- The RPC gains an eighth argument, so the old seven-argument signature has to go
-- rather than linger as an ambiguous overload.
drop function if exists public.botc_update_game(
  text, text, integer, text, integer, jsonb, jsonb
);

create or replace function public.botc_update_game(
  p_join_code text,
  p_storyteller_token_hash text,
  p_expected_version integer,
  p_phase text default null,
  p_day_number integer default null,
  p_seats jsonb default null,
  p_game_tokens jsonb default null,
  p_day_state jsonb default null
)
returns table (game_id text, game_version integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_game public.games%rowtype;
  item jsonb;
  item_id text;
  item_seat_id text;
  next_version integer;
begin
  select game.* into selected_game
  from public.games as game
  where game.join_code = upper(btrim(p_join_code))
  for update;

  if not found then
    raise exception 'BOTC_GAME_NOT_FOUND';
  end if;

  if selected_game.storyteller_token_hash <> p_storyteller_token_hash then
    raise exception 'BOTC_UNAUTHORIZED';
  end if;

  if selected_game.version <> p_expected_version then
    raise exception 'BOTC_VERSION_CONFLICT';
  end if;

  set constraints seats_game_seat_index_unique deferred;

  if p_phase is not null and p_phase not in ('setup', 'day', 'night') then
    raise exception 'BOTC_INVALID_PHASE';
  end if;

  if p_day_number is not null and p_day_number < 1 then
    raise exception 'BOTC_INVALID_DAY_NUMBER';
  end if;

  if p_day_state is not null then
    if jsonb_typeof(p_day_state) <> 'object' then
      raise exception 'BOTC_INVALID_DAY_STATE';
    end if;

    if jsonb_typeof(coalesce(p_day_state->'nominations', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(p_day_state->'nominations', '[]'::jsonb)) > 20
    then
      raise exception 'BOTC_INVALID_DAY_STATE';
    end if;
  end if;

  if p_seats is not null then
    if jsonb_typeof(p_seats) <> 'array' or jsonb_array_length(p_seats) > 20 then
      raise exception 'BOTC_INVALID_SEATS';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_seats) proposed
      group by proposed->>'id'
      having count(*) > 1
    ) or exists (
      select 1
      from jsonb_array_elements(p_seats) proposed
      group by (proposed->>'seatIndex')::integer
      having count(*) > 1
    ) then
      raise exception 'BOTC_DUPLICATE_SEATS';
    end if;

    if exists (
      select 1
      from public.seats existing
      join jsonb_array_elements(p_seats) proposed
        on existing.id = proposed->>'id'
      where existing.game_id <> selected_game.id
    ) then
      raise exception 'BOTC_FOREIGN_SEAT';
    end if;

    for item in select value from jsonb_array_elements(p_seats) loop
      item_id := item->>'id';

      if item_id is null
        or length(btrim(item->>'playerName')) < 1
        or length(btrim(item->>'playerName')) > 40
        or (item->>'seatIndex')::integer < 0
      then
        raise exception 'BOTC_INVALID_SEAT';
      end if;

      if exists (
        select 1 from public.seats as seat
        where seat.id = item_id and seat.game_id = selected_game.id
      ) then
        update public.seats as seat
        set seat_index = (item->>'seatIndex')::integer,
            player_name = btrim(item->>'playerName'),
            role_id = nullif(item->>'roleId', ''),
            alignment = item->>'alignment',
            alive = (item->>'alive')::boolean,
            ghost_vote_available = (item->>'ghostVoteAvailable')::boolean,
            is_traveller = (item->>'isTraveller')::boolean
        where seat.id = item_id and seat.game_id = selected_game.id;
      else
        insert into public.seats (
          id,
          game_id,
          seat_index,
          player_name,
          role_id,
          alignment,
          alive,
          ghost_vote_available,
          is_traveller
        ) values (
          item_id,
          selected_game.id,
          (item->>'seatIndex')::integer,
          btrim(item->>'playerName'),
          nullif(item->>'roleId', ''),
          item->>'alignment',
          (item->>'alive')::boolean,
          (item->>'ghostVoteAvailable')::boolean,
          (item->>'isTraveller')::boolean
        );
      end if;
    end loop;

    delete from public.seats existing
    where existing.game_id = selected_game.id
      and not exists (
        select 1 from jsonb_array_elements(p_seats) proposed
        where proposed->>'id' = existing.id
      );
  end if;

  if p_game_tokens is not null then
    if jsonb_typeof(p_game_tokens) <> 'array' or jsonb_array_length(p_game_tokens) > 250 then
      raise exception 'BOTC_INVALID_TOKENS';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_game_tokens) proposed
      group by proposed->>'id'
      having count(*) > 1
    ) then
      raise exception 'BOTC_DUPLICATE_TOKENS';
    end if;

    if exists (
      select 1
      from public.game_tokens existing
      join jsonb_array_elements(p_game_tokens) proposed
        on existing.id = proposed->>'id'
      where existing.game_id <> selected_game.id
    ) then
      raise exception 'BOTC_FOREIGN_TOKEN';
    end if;

    for item in select value from jsonb_array_elements(p_game_tokens) loop
      item_id := item->>'id';
      item_seat_id := nullif(item->>'seatId', '');

      if item_id is null
        or length(btrim(item->>'label')) < 1
        or length(btrim(item->>'label')) > 80
        or (item->>'position')::integer < 0
        or jsonb_typeof(coalesce(item->'metadata', '{}'::jsonb)) <> 'object'
      then
        raise exception 'BOTC_INVALID_TOKEN';
      end if;

      if item_seat_id is not null and not exists (
        select 1 from public.seats as seat
        where seat.id = item_seat_id and seat.game_id = selected_game.id
      ) then
        raise exception 'BOTC_FOREIGN_TOKEN_SEAT';
      end if;
    end loop;

    delete from public.game_tokens as token
    where token.game_id = selected_game.id;

    insert into public.game_tokens (
      id,
      game_id,
      seat_id,
      token_type,
      role_id,
      label,
      position,
      metadata
    )
    select
      proposed->>'id',
      selected_game.id,
      nullif(proposed->>'seatId', ''),
      proposed->>'tokenType',
      nullif(proposed->>'roleId', ''),
      btrim(proposed->>'label'),
      (proposed->>'position')::integer,
      coalesce(proposed->'metadata', '{}'::jsonb)
    from jsonb_array_elements(p_game_tokens) proposed;
  end if;

  next_version := selected_game.version + 1;

  update public.games as game
  set phase = coalesce(p_phase, phase),
      day_number = coalesce(p_day_number, day_number),
      day_state = coalesce(p_day_state, day_state),
      version = next_version,
      updated_at = now()
  where game.id = selected_game.id and game.version = p_expected_version;

  if not found then
    raise exception 'BOTC_VERSION_CONFLICT';
  end if;

  return query select selected_game.id, next_version;
end;
$$;

revoke all on function public.botc_update_game(text, text, integer, text, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.botc_update_game(text, text, integer, text, integer, jsonb, jsonb, jsonb)
  to service_role;
