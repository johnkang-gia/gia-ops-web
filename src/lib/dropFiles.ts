// 끌어다 놓은 것에서 파일을 꺼냅니다.
//
// **폴더를 놓으면 `dataTransfer.files` 는 비어 있습니다.** 브라우저가 폴더를 파일 목록에
// 넣어주지 않기 때문입니다(넣어주는 것처럼 보여도 크기 0짜리 껍데기입니다). 폴더 안을 보려면
// `webkitGetAsEntry()` 로 한 겹씩 들어가야 합니다.
//
// 이걸 모르면 사진 폴더를 통째로 끌어다 놓았을 때 **아무 일도 일어나지 않습니다.** 화면에는
// 오류도 안 뜨고 목록도 안 생겨서, 되고 있는지 아닌지 알 수가 없습니다.

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file(cb: (f: File) => void, err?: (e: unknown) => void): void;
  createReader(): { readEntries(cb: (es: Entry[]) => void, err?: (e: unknown) => void): void };
};

function readEntry(entry: Entry, depth: number): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => entry.file((f) => resolve([f]), () => resolve([])));
  }
  // 폴더 안에 폴더가 있어도 따라 들어갑니다(학년별로 나눠둔 경우). 다만 끝없이 들어가지는
  // 않게 깊이를 막아둡니다.
  if (!entry.isDirectory || depth > 5) return Promise.resolve([]);
  const reader = entry.createReader();
  return new Promise((resolve) => {
    const all: Entry[] = [];
    // readEntries 는 한 번에 100개까지만 돌려줍니다. 빈 배열이 올 때까지 반복해야
    // 100장이 넘는 폴더에서 뒤쪽 사진이 통째로 빠지지 않습니다.
    const step = () =>
      reader.readEntries(
        (es) => {
          if (es.length === 0) {
            void Promise.all(all.map((e) => readEntry(e, depth + 1))).then((lists) => resolve(lists.flat()));
            return;
          }
          all.push(...es);
          step();
        },
        () => resolve([]),
      );
    step();
  });
}

/** 놓은 것에서 파일을 전부 꺼냅니다. 폴더면 안까지 들어갑니다. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = [...(dt.items ?? [])];
  // 브라우저가 주는 FileSystemEntry 타입에는 file()/createReader()가 선언돼 있지 않아
  // 우리 쪽 모양으로 받습니다.
  const getter = (it: DataTransferItem): Entry | null => {
    const fn = (it as unknown as { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry;
    if (typeof fn !== "function") return null;
    const e = fn.call(it) as Entry | null;
    return e && typeof e.isFile === "boolean" ? e : null;
  };

  const entries = items.filter((it) => it.kind === "file").map(getter).filter((e): e is Entry => e !== null);
  if (entries.length > 0) {
    const lists = await Promise.all(entries.map((e) => readEntry(e, 0)));
    const files = lists.flat();
    if (files.length > 0) return files;
  }
  // 폴더 훑기를 못 쓰는 브라우저를 위한 대비책.
  return [...dt.files];
}

/** 그림 파일만 남깁니다. 어떤 것이 왜 빠졌는지도 같이 돌려줍니다. */
export function pickImages(files: File[]): { images: File[]; skipped: { name: string; reason: string }[] } {
  const images: File[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const f of files) {
    if (/^\./.test(f.name)) continue; // .DS_Store 같은 숨김 파일은 말없이 지나갑니다.
    // HEIC(아이폰 사진)는 브라우저가 못 엽니다. 조용히 빼면 "몇 장이 없네"가 되므로 이유를 말합니다.
    if (/\.hei[cf]$/i.test(f.name)) {
      skipped.push({ name: f.name, reason: "HEIC은 브라우저가 열지 못합니다 — JPG로 내보내 주세요" });
      continue;
    }
    if (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) {
      images.push(f);
      continue;
    }
    skipped.push({ name: f.name, reason: "그림 파일이 아닙니다" });
  }
  return { images, skipped };
}
