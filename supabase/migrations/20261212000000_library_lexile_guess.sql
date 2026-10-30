/*
  ── 렉사일 추정값과 그 출처 ─────────────────────────────────────────────────

  "모르는 책은 비워두지 말고 책장에 배정은 해줘 ... 시리즈별, 알파벳별, 렉사일별의 기준들을
  순차적으로 적용해서 가장 최적의 정리를 찾을 수 있도록."

  렉사일은 MetaMetrics 의 측정값이라 조회처(국중·카카오·구글북스·오픈라이브러리)가 주지
  않습니다. 그래서 지금까지 렉사일 칸은 늘 비어 있었고, 「렉사일 순」은 쪽수로 대신했습니다.

  널리 읽히는 책의 렉사일은 **AI 가 알거나 꽤 좁게 추정**할 수 있습니다(Hatchet 1020L,
  Flowers for Algernon 910L 처럼). 비어 있는 것보다 추정값이 낫습니다 - 그래야 쉬운 책부터
  어려운 책 순으로 세울 수 있고, 아이가 자기 수준의 책을 한 자리에서 고를 수 있습니다.

  다만 **추정값을 측정값인 척해서는 안 됩니다.** 그래서 출처를 함께 적습니다.

    lexile_guess = true  → AI 가 추정한 값(화면에 '추정'으로 표시)
    lexile_guess = false → 사람이 측정값을 적은 것

  정리에는 둘 다 씁니다. 다만 사람이 적은 값이 늘 우선입니다.
*/

alter table public.lib_books
  add column if not exists lexile_guess boolean not null default false;

comment on column public.lib_books.lexile_guess is
  '렉사일이 AI 추정값인지. true 면 화면에 ''추정''으로 표시합니다. 사람이 적은 측정값은 false.';

comment on column public.lib_books.lexile is
  '렉사일 지수. 조회처는 주지 않아서 사람이 적거나 AI가 추정합니다(lexile_guess 로 가립니다). 쉬운 책 → 어려운 책 순으로 세울 때 씁니다.';

notify pgrst, 'reload schema';
