"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * **개발자에게 보낼 쪽지를 한 장으로 모읍니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 쪽지 복사가 사이트 점검 패널 안에만 있었습니다. 그래서 자료 등기소에서 찾은 것은 그 쪽지에
 * 안 담기고, 사람이 손으로 옮겨 적어야 했습니다. **옮겨 적는 자리가 있으면 옮겨 적히지
 * 않습니다** - 그 자리에서 끝나지 않는 일은 대개 안 하게 됩니다.
 *
 * 패널마다 자기 몫의 글을 여기 등록해 두면, 복사 단추 하나가 전부 이어 붙여 내보냅니다.
 * 새 패널이 생겨도 복사 단추를 또 만들 필요가 없습니다 - 등록만 하면 됩니다.
 *
 * 글은 **패널이 만듭니다.** 여기서 모양을 정하면 패널마다 다른 자료를 같은 틀에 욱여넣게 되고,
 * 그러면 정작 필요한 숫자가 빠집니다.
 */

type Section = { order: number; text: string };

type Store = {
  /** 이 패널의 글을 등록합니다. 빈 글을 넣으면 그 칸이 빠집니다. */
  put: (key: string, order: number, text: string) => void;
  /** 지금까지 등록된 글 전부를 한 장으로. */
  build: () => string;
  /** 복사 단추가 몇 칸을 담고 있는지 화면에 적기 위한 값. */
  count: number;
};

const Ctx = createContext<Store | null>(null);

export function DevReportProvider({ children }: { children: React.ReactNode }) {
  // 글 자체는 ref 에 둡니다. 글이 바뀔 때마다 화면 전체를 다시 그릴 이유가 없습니다 -
  // 바뀌어야 하는 것은 「몇 칸이 담겼나」뿐입니다.
  const sections = useRef(new Map<string, Section>());
  const [count, setCount] = useState(0);

  const put = useCallback((key: string, order: number, text: string) => {
    const trimmed = text.trim();
    if (trimmed) sections.current.set(key, { order, text: trimmed });
    else sections.current.delete(key);
    setCount(sections.current.size);
  }, []);

  const build = useCallback(
    () =>
      [...sections.current.values()]
        .sort((a, b) => a.order - b.order)
        .map((s) => s.text)
        .join("\n\n"),
    [],
  );

  const value = useMemo(() => ({ put, build, count }), [put, build, count]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * 쪽지에 자기 몫을 등록합니다.
 *
 * 제공자 밖에서 불려도 **터지지 않습니다** - 아무 데도 안 담길 뿐입니다. 개발자 화면의 한
 * 조각이 다른 화면에 재사용될 때 그 화면이 통째로 안 뜨는 편이 더 나쁩니다.
 */
export function useDevReport(): Store {
  return (
    useContext(Ctx) ?? {
      put: () => {},
      build: () => "",
      count: 0,
    }
  );
}
