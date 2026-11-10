export type MusicMoodDefinition = { id: string; name: string; color: string };
export type MusicArtistDefinition = { id: string; name: string };

export const MUSIC_MOODS: MusicMoodDefinition[] = [
  { id: "calm", name: "Спокойное", color: "#9ba2ad" },
  { id: "joyful", name: "Радостное", color: "#f2c94c" },
  { id: "aggressive", name: "Агрессивное", color: "#ff5555" },
  { id: "sad", name: "Грустное", color: "#5da2ff" },
];

export type MusicMoodId = string;

export const MUSIC_ARTISTS: MusicArtistDefinition[] = [
  { id: "young-brick", name: "Молодой кирпич" },
  { id: "vlio666", name: "Vlio666" },
  { id: "kr1mz00n", name: "Kr1mz00n" },
  { id: "emerald", name: "Emerald" },
  { id: "suno", name: "Suno" },
];

export function splitArtistNames(value: string) {
  return [...new Set(value.split(/[\n,;]+|\s+(?:feat(?:uring)?|ft|with)\.?\s+/i).map(name => name.trim()).filter(Boolean))];
}
