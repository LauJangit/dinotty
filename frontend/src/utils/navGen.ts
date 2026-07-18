let revealNavGen = 0

export function nextRevealNavGen(): number {
  return ++revealNavGen
}

export function currentRevealNavGen(): number {
  return revealNavGen
}
