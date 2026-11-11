-- ==============================================================================
-- 16-reward-punishment-justification.sql
--
-- A punishment or a reward now records the reason it was applied, the same way an
-- absence records its justification. Two seeded vocabularies hold the reasons —
-- punishment_justification and reward_justification — each with a stable code
-- and one label per language, so the conduct pages, the student history and the
-- printed student report can show why the entry was recorded.
--
-- Existing entries are kept and filed under OTHER: a record written before the
-- column existed carries no better reason than "other". From then on the column
-- is required, mirroring student_gets_absent.absence_justification_id.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 16-reward-punishment-justification.sql
--
-- Safe to re-run: every statement checks for what already exists.
-- ==============================================================================

BEGIN;

-- ---- Lookups ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.punishment_justification (
    punishment_justification_id integer NOT NULL,
    punishment_justification_code character varying(48) DEFAULT NULL::character varying,
    punishment_justification_label_en character varying(48),
    punishment_justification_label_ar character varying(48),
    punishment_justification_label_fr character varying(48)
);

CREATE SEQUENCE IF NOT EXISTS public.punishment_justification_punishment_justification_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.punishment_justification_punishment_justification_id_seq
    OWNED BY public.punishment_justification.punishment_justification_id;

ALTER TABLE public.punishment_justification
    ALTER COLUMN punishment_justification_id
    SET DEFAULT nextval('public.punishment_justification_punishment_justification_id_seq'::regclass);

CREATE TABLE IF NOT EXISTS public.reward_justification (
    reward_justification_id integer NOT NULL,
    reward_justification_code character varying(48) DEFAULT NULL::character varying,
    reward_justification_label_en character varying(48),
    reward_justification_label_ar character varying(48),
    reward_justification_label_fr character varying(48)
);

CREATE SEQUENCE IF NOT EXISTS public.reward_justification_reward_justification_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.reward_justification_reward_justification_id_seq
    OWNED BY public.reward_justification.reward_justification_id;

ALTER TABLE public.reward_justification
    ALTER COLUMN reward_justification_id
    SET DEFAULT nextval('public.reward_justification_reward_justification_id_seq'::regclass);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'punishment_justification_pkey') THEN
    ALTER TABLE public.punishment_justification
      ADD CONSTRAINT punishment_justification_pkey PRIMARY KEY (punishment_justification_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'punishment_justification_punishment_justification_code_key') THEN
    ALTER TABLE public.punishment_justification
      ADD CONSTRAINT punishment_justification_punishment_justification_code_key
      UNIQUE (punishment_justification_code);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reward_justification_pkey') THEN
    ALTER TABLE public.reward_justification
      ADD CONSTRAINT reward_justification_pkey PRIMARY KEY (reward_justification_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reward_justification_reward_justification_code_key') THEN
    ALTER TABLE public.reward_justification
      ADD CONSTRAINT reward_justification_reward_justification_code_key
      UNIQUE (reward_justification_code);
  END IF;
END
$$;

-- ---- Seeded vocabularies ---------------------------------------------------
-- The codes are the stable key (the interface matches on them); the labels carry
-- the three languages of the interface.

INSERT INTO public.punishment_justification
  (punishment_justification_code, punishment_justification_label_en, punishment_justification_label_ar, punishment_justification_label_fr)
VALUES
  ('ABSENCE', 'Unjustified absence', 'غياب غير مبرر', 'Absence non justifiée'),
  ('LATE', 'Repeated lateness', 'تأخر متكرر', 'Retards répétés'),
  ('DISRUPTION', 'Disruption of class', 'إخلال بالنظام', 'Perturbation du cours'),
  ('DISRESPECT', 'Disrespect', 'عدم احترام', 'Manque de respect'),
  ('CHEATING', 'Cheating', 'غش', 'Tricherie'),
  ('OTHER', 'Other', 'آخر', 'Autre')
ON CONFLICT (punishment_justification_code) DO NOTHING;

INSERT INTO public.reward_justification
  (reward_justification_code, reward_justification_label_en, reward_justification_label_ar, reward_justification_label_fr)
VALUES
  ('EXCELLENCE', 'Academic excellence', 'تفوق دراسي', 'Excellence académique'),
  ('CONDUCT', 'Good conduct', 'حسن السلوك', 'Bonne conduite'),
  ('ATTENDANCE', 'Regular attendance', 'مواظبة على الحضور', 'Assiduité'),
  ('PARTICIPATION', 'Active participation', 'مشاركة فعالة', 'Participation active'),
  ('IMPROVEMENT', 'Notable improvement', 'تحسن ملحوظ', 'Progrès notable'),
  ('OTHER', 'Other', 'آخر', 'Autre')
ON CONFLICT (reward_justification_code) DO NOTHING;

-- ---- Applied entries -------------------------------------------------------

ALTER TABLE public.secretary_punishes_student
    ADD COLUMN IF NOT EXISTS punishment_justification_id integer;

ALTER TABLE public.secretary_rewards_student
    ADD COLUMN IF NOT EXISTS reward_justification_id integer;

UPDATE public.secretary_punishes_student
   SET punishment_justification_id = (
         SELECT punishment_justification_id
           FROM public.punishment_justification
          WHERE punishment_justification_code = 'OTHER')
 WHERE punishment_justification_id IS NULL;

UPDATE public.secretary_rewards_student
   SET reward_justification_id = (
         SELECT reward_justification_id
           FROM public.reward_justification
          WHERE reward_justification_code = 'OTHER')
 WHERE reward_justification_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secretary_punishes_student_punishment_justification_id_fkey') THEN
    ALTER TABLE public.secretary_punishes_student
      ADD CONSTRAINT secretary_punishes_student_punishment_justification_id_fkey
      FOREIGN KEY (punishment_justification_id)
      REFERENCES public.punishment_justification(punishment_justification_id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'secretary_rewards_student_reward_justification_id_fkey') THEN
    ALTER TABLE public.secretary_rewards_student
      ADD CONSTRAINT secretary_rewards_student_reward_justification_id_fkey
      FOREIGN KEY (reward_justification_id)
      REFERENCES public.reward_justification(reward_justification_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

ALTER TABLE public.secretary_punishes_student
    ALTER COLUMN punishment_justification_id SET NOT NULL;

ALTER TABLE public.secretary_rewards_student
    ALTER COLUMN reward_justification_id SET NOT NULL;

-- Grant to the application role when it exists (the LAN server creates it in
-- 01-init-enote.sql; a local development database often only has postgres).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    GRANT ALL ON TABLE public.punishment_justification TO enote_app;
    GRANT ALL ON SEQUENCE public.punishment_justification_punishment_justification_id_seq TO enote_app;
    GRANT ALL ON TABLE public.reward_justification TO enote_app;
    GRANT ALL ON SEQUENCE public.reward_justification_reward_justification_id_seq TO enote_app;
  END IF;
END
$$;

COMMIT;
