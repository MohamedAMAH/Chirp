import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { DictationTotals } from "../shared/dashboard";

const empty = (): DictationTotals => ({ words: 0, dictations: 0, seconds: 0 });
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

function weekPosition(now: Date) {
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - day,
  );
  return {
    day,
    week: `${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`,
  };
}

function readTotals(value: unknown): DictationTotals {
  if (!value || typeof value !== "object") return empty();
  const { words, dictations, seconds } = value as Partial<DictationTotals>;
  if (
    typeof words !== "number" ||
    !Number.isSafeInteger(words) ||
    words < 0 ||
    typeof dictations !== "number" ||
    !Number.isSafeInteger(dictations) ||
    dictations < 0 ||
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0
  )
    return empty();
  return { words, dictations, seconds };
}

function add(a: DictationTotals, b: DictationTotals): DictationTotals {
  return {
    words: a.words + b.words,
    dictations: a.dictations + b.dictations,
    seconds: a.seconds + b.seconds,
  };
}

export class DictationActivity {
  private week = "";
  private days = Array.from({ length: 7 }, empty);
  private allTime = empty();

  constructor(private readonly file: string) {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      this.allTime = readTotals(data.allTime);
      if (
        typeof data.week === "string" &&
        Array.isArray(data.days) &&
        data.days.length === 7
      ) {
        this.week = data.week;
        this.days = data.days.map(readTotals);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Could not read Chirp activity.", error);
    }
  }

  get snapshot() {
    const days =
      this.week === weekPosition(new Date()).week
        ? this.days
        : Array.from({ length: 7 }, empty);
    return {
      allTime: this.allTime,
      thisWeek: days.reduce(add, empty()),
      dailyWords: days.map((day) => day.words),
    };
  }

  record(text: string, samples: number, now = new Date()) {
    let words = 0;
    for (const segment of segmenter.segment(text))
      if (segment.isWordLike) words++;
    const totals = { words, dictations: 1, seconds: samples / 16000 };
    const { week, day } = weekPosition(now);
    if (week !== this.week) {
      this.week = week;
      this.days = Array.from({ length: 7 }, empty);
    }
    this.days[day] = add(this.days[day], totals);
    this.allTime = add(this.allTime, totals);
    try {
      writeFileSync(
        this.file + ".tmp",
        JSON.stringify({
          week,
          days: this.days,
          allTime: this.allTime,
        }),
        "utf8",
      );
      renameSync(this.file + ".tmp", this.file);
    } catch (error) {
      console.warn("Could not save Chirp activity.", error);
    }
  }
}
