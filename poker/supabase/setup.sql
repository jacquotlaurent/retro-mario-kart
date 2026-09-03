/* ═══════════════════════════════════════════════════════════════════════════
   PLANNING POKER — schéma et API
   ───────────────────────────────────────────────────────────────────────────
   Même convention de sécurité que la rétro Mario Kart :

     • RLS activée sur toutes les tables, et AUCUNE policy : aucune ligne ne
       sort jamais par l'API REST ou Realtime « postgres_changes ».
     • Le navigateur ne parle qu'aux fonctions `security definer` ci-dessous,
       seules à porter le `grant execute to anon`.

   C'est ce qui rend le vote réellement secret : les cartes jouées vivent dans
   public.poker_vote, table injoignable depuis le front. Tant que le tour n'est
   pas révélé, poker_state ne renvoie que « a voté / n'a pas voté » — plus la
   carte de l'appelant, pour qu'il voie son propre choix. Aucune autre valeur
   ne traverse le réseau.

   Le barème (1 · 2 · 3 · 5 · 8 · 13 · 21 · 34 · 55 · ?) vit lui aussi dans la
   base (public.poker_card) : personne ne peut jouer une carte inventée depuis
   la console du navigateur.
   ═══════════════════════════════════════════════════════════════════════════ */

-- ─── Le barème ────────────────────────────────────────────────────────────

create table if not exists public.poker_card (
  id      text primary key,
  ordinal integer not null,
  value   numeric            -- null pour « ? » : la carte reste hors moyenne
);

insert into public.poker_card (id, ordinal, value) values
  ('1', 1, 1), ('2', 2, 2), ('3', 3, 3), ('5', 4, 5), ('8', 5, 8),
  ('13', 6, 13), ('21', 7, 21), ('34', 8, 34), ('55', 9, 55), ('?', 10, null)
on conflict (id) do update set ordinal = excluded.ordinal, value = excluded.value;

-- ─── Les tables de session ────────────────────────────────────────────────

create table if not exists public.poker_session (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  created_at        timestamptz not null default now(),
  current_ticket_id uuid,
  revision          bigint not null default 0
);

create table if not exists public.poker_participant (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.poker_session(id) on delete cascade,
  token          text not null,
  name           text not null,
  role           text not null check (role in ('participant', 'spectateur')),
  is_facilitator boolean not null default false,
  joined_at      timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  left_at        timestamptz,
  unique (session_id, token)
);

create table if not exists public.poker_ticket (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.poker_session(id) on delete cascade,
  ordinal        integer not null,
  ticket_key     text not null,
  title          text not null,
  final_estimate text references public.poker_card(id),
  estimated_at   timestamptz,
  unique (session_id, ordinal)
);

create table if not exists public.poker_round (
  id               uuid primary key default gen_random_uuid(),
  ticket_id        uuid not null references public.poker_ticket(id) on delete cascade,
  number           integer not null,
  started_at       timestamptz not null default now(),
  revealed_at      timestamptz,
  timer_started_at timestamptz,
  timer_seconds    integer,
  unique (ticket_id, number)
);

create table if not exists public.poker_vote (
  round_id       uuid not null references public.poker_round(id) on delete cascade,
  participant_id uuid not null references public.poker_participant(id) on delete cascade,
  card           text not null references public.poker_card(id),
  voted_at       timestamptz not null default now(),
  primary key (round_id, participant_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'poker_session_current_ticket_fkey'
  ) then
    alter table public.poker_session
      add constraint poker_session_current_ticket_fkey
      foreign key (current_ticket_id) references public.poker_ticket(id) on delete set null;
  end if;
end $$;

create index if not exists poker_participant_session_idx on public.poker_participant (session_id);
create index if not exists poker_ticket_session_idx      on public.poker_ticket (session_id, ordinal);
create index if not exists poker_round_ticket_idx        on public.poker_round (ticket_id, number desc);

alter table public.poker_card        enable row level security;
alter table public.poker_session     enable row level security;
alter table public.poker_participant enable row level security;
alter table public.poker_ticket      enable row level security;
alter table public.poker_round       enable row level security;
alter table public.poker_vote        enable row level security;
-- Volontairement : AUCUNE policy. Rien ne passe en direct.

revoke all on table public.poker_card, public.poker_session, public.poker_participant,
                     public.poker_ticket, public.poker_round, public.poker_vote
  from anon, authenticated;

/* ═══════════════════════════════════════════════════════════════════════════
   Rouages internes — jamais exposés à anon
   ═══════════════════════════════════════════════════════════════════════════ */

/** Au-delà de ce délai sans nouvelle, on considère quelqu'un parti : il
    n'apparaît plus « en ligne » et ne bloque plus la révélation. */
create or replace function public.poker_online_cutoff()
returns timestamptz language sql set search_path = public, pg_temp
as $$ select now() - interval '35 seconds' $$;

/** Un code de session lisible à l'oral : ni I, ni O, ni 0, ni 1. */
create or replace function public.poker_new_code()
returns text language plpgsql set search_path = public, pg_temp as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_try  integer := 0;
begin
  loop
    v_try := v_try + 1;
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.poker_session where code = v_code);
    if v_try > 50 then raise exception 'impossible de tirer un code libre'; end if;
  end loop;
  return v_code;
end $$;

/** Retrouve l'appelant à partir du code de session et de son jeton. */
create or replace function public.poker_actor(p_code text, p_token text)
returns table (session_id uuid, participant_id uuid, is_facilitator boolean, role text)
language sql security definer set search_path = public, pg_temp as $$
  select s.id, p.id, p.is_facilitator, p.role
  from public.poker_session s
  join public.poker_participant p on p.session_id = s.id and p.token = p_token
  where s.code = upper(btrim(p_code)) and p.left_at is null
$$;

/** Incrémente la révision et prévient tous les écrans via Supabase Realtime.

    La notification ne transporte QUE le numéro de révision : pas un seul vote.
    Chaque écran rappelle poker_state, qui décide de ce qu'il a le droit de
    voir. Si Realtime est indisponible, le sondage de repli prend le relais —
    d'où le `exception when others`. */
create or replace function public.poker_touch(p_session uuid)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_rev bigint;
begin
  update public.poker_session set revision = revision + 1
    where id = p_session
    returning code, revision into v_code, v_rev;

  begin
    perform realtime.send(
      jsonb_build_object('revision', v_rev), 'maj', 'poker:' || v_code, false);
  exception when others then null;
  end;

  return v_rev;
end $$;

/** Le tour en cours du ticket courant, s'il existe. */
create or replace function public.poker_current_round(p_session uuid)
returns uuid language sql security definer set search_path = public, pg_temp as $$
  select r.id
  from public.poker_session s
  join public.poker_round r on r.ticket_id = s.current_ticket_id
  where s.id = p_session
  order by r.number desc
  limit 1
$$;

/** Ouvre le tour n+1 sur un ticket (ou le tour 1 s'il n'en a aucun). */
create or replace function public.poker_open_round(p_ticket uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.poker_round (ticket_id, number)
  select p_ticket, coalesce(max(number), 0) + 1
    from public.poker_round where ticket_id = p_ticket
  returning id into v_id;
  return v_id;
end $$;

/** Révèle dès que tous les participants présents ont voté.

    Les spectateurs sont hors du compte, et les absents (silencieux depuis plus
    de 35 s) ne bloquent personne. */
create or replace function public.poker_try_reveal(p_round uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session  uuid;
  v_attendus integer;
  v_votes    integer;
begin
  if p_round is null then return false; end if;

  select t.session_id into v_session
  from public.poker_round r
  join public.poker_ticket t on t.id = r.ticket_id
  where r.id = p_round and r.revealed_at is null;
  if v_session is null then return false; end if;

  select count(*),
         count(*) filter (where exists (
           select 1 from public.poker_vote v
           where v.round_id = p_round and v.participant_id = p.id))
    into v_attendus, v_votes
  from public.poker_participant p
  where p.session_id = v_session
    and p.left_at is null
    and p.role = 'participant'
    and p.last_seen_at > public.poker_online_cutoff();

  if v_attendus = 0 or v_votes < v_attendus then return false; end if;

  update public.poker_round set revealed_at = now()
    where id = p_round and revealed_at is null;
  return true;
end $$;

/** Le dépouillement d'un tour révélé. Le « ? » ne pèse pas dans la moyenne. */
create or replace function public.poker_tally(p_round uuid)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  with v as (
    select vt.card, c.value, c.ordinal
    from public.poker_vote vt
    join public.poker_card c on c.id = vt.card
    where vt.round_id = p_round
  )
  select jsonb_build_object(
    'votes',         (select count(*) from v),
    'numeric_votes', (select count(value) from v),
    'average',       (select round(avg(value), 2) from v),
    'min',           (select min(value) from v),
    'max',           (select max(value) from v),
    -- « tous les votes numériques identiques », et au moins deux pour que le
    -- mot consensus ait un sens.
    'consensus',     (select count(distinct value) = 1 and count(value) >= 2 from v),
    'distribution',  (select coalesce(jsonb_agg(d.bloc order by d.rang), '[]'::jsonb) from (
                        select jsonb_build_object('card', v.card, 'count', count(*)) as bloc,
                               min(v.ordinal) as rang
                        from v group by v.card
                      ) d)
  )
$$;

/** L'état complet vu par un participant donné — c'est ici que se joue le secret. */
create or replace function public.poker_state_json(p_session uuid, p_me uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_session  record;
  v_ticket   record;
  v_round    record;
  v_revealed boolean;
begin
  select * into v_session from public.poker_session where id = p_session;
  if v_session.id is null then raise exception 'session inconnue' using errcode = 'P0002'; end if;

  select * into v_ticket from public.poker_ticket where id = v_session.current_ticket_id;
  select * into v_round  from public.poker_round
    where ticket_id = v_ticket.id order by number desc limit 1;
  v_revealed := v_round.revealed_at is not null;

  return jsonb_build_object(
    'ok', true,
    'server_now', now(),
    'revision', v_session.revision,
    'code', v_session.code,

    'deck', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'value', c.value)
                             order by c.ordinal), '[]'::jsonb)
             from public.poker_card c),

    'me', (select jsonb_build_object(
              'id', p.id, 'name', p.name, 'role', p.role,
              'is_facilitator', p.is_facilitator,
              'vote', (select v.card from public.poker_vote v
                       where v.round_id = v_round.id and v.participant_id = p.id))
           from public.poker_participant p where p.id = p_me),

    'participants', (
      select coalesce(jsonb_agg(bloc order by rang_facilitateur, rang_arrivee), '[]'::jsonb)
      from (
        select jsonb_build_object(
                 'id', p.id, 'name', p.name, 'role', p.role,
                 'is_facilitator', p.is_facilitator,
                 'online', p.last_seen_at > public.poker_online_cutoff(),
                 'has_voted', exists (select 1 from public.poker_vote v
                                      where v.round_id = v_round.id and v.participant_id = p.id),
                 -- La carte n'apparaît qu'après la révélation. Jamais avant.
                 'vote', case when v_revealed then (
                           select v.card from public.poker_vote v
                           where v.round_id = v_round.id and v.participant_id = p.id)
                         end
               ) as bloc,
               not p.is_facilitator as rang_facilitateur,
               p.joined_at as rang_arrivee
        from public.poker_participant p
        where p.session_id = p_session and p.left_at is null
      ) q),

    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id, 'ordinal', t.ordinal, 'key', t.ticket_key, 'title', t.title,
               'final_estimate', t.final_estimate,
               'current', t.id = v_session.current_ticket_id) order by t.ordinal), '[]'::jsonb)
      from public.poker_ticket t where t.session_id = p_session),

    'ticket', case when v_ticket.id is null then null else jsonb_build_object(
      'id', v_ticket.id, 'ordinal', v_ticket.ordinal, 'key', v_ticket.ticket_key,
      'title', v_ticket.title, 'final_estimate', v_ticket.final_estimate) end,

    'round', case when v_round.id is null then null else jsonb_build_object(
      'id', v_round.id, 'number', v_round.number, 'revealed', v_revealed,
      'timer_started_at', v_round.timer_started_at,
      'timer_seconds', v_round.timer_seconds) end,

    'tally', case when v_revealed then public.poker_tally(v_round.id) end
  );
end $$;

/** Nettoyage d'hygiène : les sessions de plus de sept jours s'effacent. */
create or replace function public.poker_gc()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  with morts as (
    delete from public.poker_session
    where created_at < now() - interval '7 days'
    returning 1
  ) select count(*) into v_n from morts;
  return v_n;
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   L'API exposée au navigateur
   ═══════════════════════════════════════════════════════════════════════════ */

create or replace function public.poker_create_session(
  p_token text, p_name text, p_role text default 'participant')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_role    text := lower(coalesce(p_role, 'participant'));
  v_session uuid;
  v_me      uuid;
begin
  if v_name is null then raise exception 'prénom manquant' using errcode = '22023'; end if;
  if p_token is null or length(p_token) < 8 then
    raise exception 'jeton invalide' using errcode = '22023';
  end if;
  if v_role not in ('participant', 'spectateur') then v_role := 'participant'; end if;

  perform public.poker_gc();

  insert into public.poker_session (code) values (public.poker_new_code())
    returning id into v_session;

  insert into public.poker_participant (session_id, token, name, role, is_facilitator)
    values (v_session, p_token, left(v_name, 40), v_role, true)
    returning id into v_me;

  perform public.poker_touch(v_session);
  return public.poker_state_json(v_session, v_me);
end $$;

create or replace function public.poker_join(
  p_code text, p_token text, p_name text, p_role text default 'participant')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_role    text := lower(coalesce(p_role, 'participant'));
  v_session uuid;
  v_me      uuid;
  v_chef    boolean;
begin
  if v_name is null then raise exception 'prénom manquant' using errcode = '22023'; end if;
  if p_token is null or length(p_token) < 8 then
    raise exception 'jeton invalide' using errcode = '22023';
  end if;
  if v_role not in ('participant', 'spectateur') then v_role := 'participant'; end if;

  select id into v_session from public.poker_session where code = upper(btrim(coalesce(p_code, '')));
  if v_session is null then
    raise exception 'aucune session à ce code' using errcode = 'P0002';
  end if;

  -- Une session sans facilitateur présent est une session morte : le premier
  -- arrivant reprend l'animation.
  v_chef := not exists (
    select 1 from public.poker_participant p
    where p.session_id = v_session and p.is_facilitator and p.left_at is null
      and p.last_seen_at > public.poker_online_cutoff());

  insert into public.poker_participant (session_id, token, name, role, is_facilitator)
    values (v_session, p_token, left(v_name, 40), v_role, v_chef)
  on conflict (session_id, token) do update
    set name = excluded.name,
        role = excluded.role,
        left_at = null,
        last_seen_at = now(),
        is_facilitator = public.poker_participant.is_facilitator or excluded.is_facilitator
  returning id into v_me;

  perform public.poker_try_reveal(public.poker_current_round(v_session));
  perform public.poker_touch(v_session);
  return public.poker_state_json(v_session, v_me);
end $$;

create or replace function public.poker_state(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;

  update public.poker_participant set last_seen_at = now() where id = a.participant_id;

  -- Un absent ne doit pas retenir le tour indéfiniment : on retente à chaque
  -- passage, une fois son silence constaté.
  perform public.poker_try_reveal(public.poker_current_round(a.session_id));

  return public.poker_state_json(a.session_id, a.participant_id);
end $$;

create or replace function public.poker_leave(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; v_round uuid;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then return jsonb_build_object('ok', true); end if;

  v_round := public.poker_current_round(a.session_id);

  update public.poker_participant set left_at = now() where id = a.participant_id;

  -- Un vote de quelqu'un qui s'en va ne doit pas peser sur un tour non révélé.
  delete from public.poker_vote v
    using public.poker_round r
    where v.round_id = r.id and r.revealed_at is null
      and v.participant_id = a.participant_id;

  perform public.poker_try_reveal(v_round);
  perform public.poker_touch(a.session_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.poker_import_tickets(
  p_code text, p_token text, p_tickets jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a          record;
  v_item     jsonb;
  v_key      text;
  v_title    text;
  v_ordinal  integer;
  v_premier  uuid;
  v_ticket   uuid;
  v_ajoutes  integer := 0;
  v_courant  uuid;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;
  if not a.is_facilitator then
    raise exception 'seul le facilitateur importe des tickets' using errcode = '42501';
  end if;
  if jsonb_typeof(p_tickets) <> 'array' then
    raise exception 'liste de tickets attendue' using errcode = '22023';
  end if;

  select coalesce(max(ordinal), 0) into v_ordinal
    from public.poker_ticket where session_id = a.session_id;

  for v_item in select * from jsonb_array_elements(p_tickets) limit 300 loop
    v_key   := nullif(btrim(coalesce(v_item->>'key', '')), '');
    v_title := nullif(btrim(coalesce(v_item->>'title', '')), '');
    if v_key is null and v_title is null then continue; end if;
    if v_key is null then v_key := '—'; end if;
    if v_title is null then v_title := v_key; end if;

    -- Réimporter la même liste ne duplique pas les tickets déjà là.
    if exists (select 1 from public.poker_ticket t
               where t.session_id = a.session_id and t.ticket_key = left(v_key, 40)
                 and t.ticket_key <> '—') then
      continue;
    end if;

    v_ordinal := v_ordinal + 1;
    insert into public.poker_ticket (session_id, ordinal, ticket_key, title)
      values (a.session_id, v_ordinal, left(v_key, 40), left(v_title, 300))
      returning id into v_ticket;
    v_ajoutes := v_ajoutes + 1;
    if v_premier is null then v_premier := v_ticket; end if;
  end loop;

  select current_ticket_id into v_courant from public.poker_session where id = a.session_id;
  if v_courant is null and v_premier is not null then
    update public.poker_session set current_ticket_id = v_premier where id = a.session_id;
    perform public.poker_open_round(v_premier);
  end if;

  perform public.poker_touch(a.session_id);
  return public.poker_state_json(a.session_id, a.participant_id) || jsonb_build_object('imported', v_ajoutes);
end $$;

create or replace function public.poker_select_ticket(
  p_code text, p_token text, p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;
  if not a.is_facilitator then
    raise exception 'seul le facilitateur choisit le ticket' using errcode = '42501';
  end if;
  if not exists (select 1 from public.poker_ticket
                 where id = p_ticket and session_id = a.session_id) then
    raise exception 'ticket inconnu' using errcode = 'P0002';
  end if;

  update public.poker_session set current_ticket_id = p_ticket where id = a.session_id;
  if not exists (select 1 from public.poker_round where ticket_id = p_ticket) then
    perform public.poker_open_round(p_ticket);
  end if;

  perform public.poker_touch(a.session_id);
  return public.poker_state_json(a.session_id, a.participant_id);
end $$;

create or replace function public.poker_vote(p_code text, p_token text, p_card text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; v_round uuid; v_revele timestamptz;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;
  if a.role <> 'participant' then
    raise exception 'les spectateurs ne votent pas' using errcode = '42501';
  end if;
  if not exists (select 1 from public.poker_card where id = p_card) then
    raise exception 'carte hors barème' using errcode = '22023';
  end if;

  v_round := public.poker_current_round(a.session_id);
  if v_round is null then
    raise exception 'aucun ticket en cours d''estimation' using errcode = 'P0002';
  end if;

  select revealed_at into v_revele from public.poker_round where id = v_round;
  if v_revele is not null then
    raise exception 'le tour est déjà révélé' using errcode = '42501';
  end if;

  insert into public.poker_vote (round_id, participant_id, card)
    values (v_round, a.participant_id, p_card)
  on conflict (round_id, participant_id) do update
    set card = excluded.card, voted_at = now();

  perform public.poker_try_reveal(v_round);
  perform public.poker_touch(a.session_id);
  return public.poker_state_json(a.session_id, a.participant_id);
end $$;

create or replace function public.poker_reveal(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; v_round uuid;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;
  if not a.is_facilitator then
    raise exception 'seul le facilitateur révèle les votes' using errcode = '42501';
  end if;

  v_round := public.poker_current_round(a.session_id);
  if v_round is null then raise exception 'aucun tour en cours' using errcode = 'P0002'; end if;

  update public.poker_round set revealed_at = now() where id = v_round and revealed_at is null;
  perform public.poker_touch(a.session_id);
  return public.poker_state_json(a.session_id, a.participant_id);
end $$;

/** Nouveau tour sur le même ticket : les votes précédents restent dans leur
    tour, le nouveau part de zéro. */
create or replace function public.poker_new_round(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; v_ticket uuid;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;
  if not a.is_facilitator then
    raise exception 'seul le facilitateur relance un tour' using errcode = '42501';
  end if;

  select current_ticket_id into v_ticket from public.poker_session where id = a.session_id;
  if v_ticket is null then raise exception 'aucun ticket en cours' using errcode = 'P0002'; end if;

  perform public.poker_open_round(v_ticket);
  perform public.poker_touch(a.session_id);
  return public.poker_state_json(a.session_id, a.participant_id);
end $$;

/** Le chrono. Facultatif, visible de tous, et il ne révèle rien de lui-même :
    à la fin du compte à rebours, les votes restent cachés. */
create or replace function public.poker_timer(
  p_code text, p_token text, p_seconds integer default 15)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; v_round uuid;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;
  if not a.is_facilitator then
    raise exception 'seul le facilitateur lance le chrono' using errcode = '42501';
  end if;

  v_round := public.poker_current_round(a.session_id);
  if v_round is null then raise exception 'aucun tour en cours' using errcode = 'P0002'; end if;

  if p_seconds is null then
    update public.poker_round set timer_started_at = null, timer_seconds = null where id = v_round;
  else
    update public.poker_round
      set timer_started_at = now(),
          timer_seconds = least(greatest(p_seconds, 5), 300)
      where id = v_round;
  end if;

  perform public.poker_touch(a.session_id);
  return public.poker_state_json(a.session_id, a.participant_id);
end $$;

/** Valide le chiffrage du ticket courant. La valeur est conservée. */
create or replace function public.poker_estimate(p_code text, p_token text, p_value text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; v_ticket uuid;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;
  if not a.is_facilitator then
    raise exception 'seul le facilitateur valide le chiffrage' using errcode = '42501';
  end if;

  select current_ticket_id into v_ticket from public.poker_session where id = a.session_id;
  if v_ticket is null then raise exception 'aucun ticket en cours' using errcode = 'P0002'; end if;

  if p_value is null then
    update public.poker_ticket set final_estimate = null, estimated_at = null where id = v_ticket;
  else
    if not exists (select 1 from public.poker_card where id = p_value) then
      raise exception 'chiffrage hors barème' using errcode = '22023';
    end if;
    update public.poker_ticket set final_estimate = p_value, estimated_at = now() where id = v_ticket;
  end if;

  perform public.poker_touch(a.session_id);
  return public.poker_state_json(a.session_id, a.participant_id);
end $$;

/** Passe au prochain ticket non chiffré, et ouvre son premier tour. */
create or replace function public.poker_next_ticket(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a record; v_courant record; v_suivant uuid;
begin
  select * into a from public.poker_actor(p_code, p_token);
  if not found then raise exception 'session ou participant inconnu' using errcode = 'P0002'; end if;
  if not a.is_facilitator then
    raise exception 'seul le facilitateur passe au ticket suivant' using errcode = '42501';
  end if;

  select t.* into v_courant
  from public.poker_session s
  left join public.poker_ticket t on t.id = s.current_ticket_id
  where s.id = a.session_id;

  select id into v_suivant from public.poker_ticket
    where session_id = a.session_id and estimated_at is null
      and ordinal > coalesce(v_courant.ordinal, 0)
    order by ordinal limit 1;

  if v_suivant is null then
    -- On boucle sur ce qui reste à chiffrer avant de déclarer la liste finie.
    select id into v_suivant from public.poker_ticket
      where session_id = a.session_id and estimated_at is null and id <> coalesce(v_courant.id, id)
      order by ordinal limit 1;
  end if;

  if v_suivant is not null then
    update public.poker_session set current_ticket_id = v_suivant where id = a.session_id;
    if not exists (select 1 from public.poker_round where ticket_id = v_suivant) then
      perform public.poker_open_round(v_suivant);
    end if;
  end if;

  perform public.poker_touch(a.session_id);
  return public.poker_state_json(a.session_id, a.participant_id)
         || jsonb_build_object('finished', v_suivant is null);
end $$;

/* ═══════════════════════════════════════════════════════════════════════════
   Droits : anon ne peut appeler que ces douze fonctions, rien d'autre.
   ═══════════════════════════════════════════════════════════════════════════ */

do $$
declare
  v_privees text[] := array[
    'poker_online_cutoff()', 'poker_new_code()', 'poker_actor(text,text)',
    'poker_touch(uuid)', 'poker_current_round(uuid)', 'poker_open_round(uuid)',
    'poker_try_reveal(uuid)', 'poker_tally(uuid)', 'poker_state_json(uuid,uuid)',
    'poker_gc()'
  ];
  v_publiques text[] := array[
    'poker_create_session(text,text,text)', 'poker_join(text,text,text,text)',
    'poker_state(text,text)', 'poker_leave(text,text)',
    'poker_import_tickets(text,text,jsonb)', 'poker_select_ticket(text,text,uuid)',
    'poker_vote(text,text,text)', 'poker_reveal(text,text)',
    'poker_new_round(text,text)', 'poker_timer(text,text,integer)',
    'poker_estimate(text,text,text)', 'poker_next_ticket(text,text)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_privees || v_publiques loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_sig);
  end loop;
  foreach v_sig in array v_publiques loop
    execute format('grant execute on function public.%s to anon', v_sig);
  end loop;
end $$;
