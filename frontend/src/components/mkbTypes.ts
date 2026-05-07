export interface KeyDef {
  l: string       // label
  s?: string       // send character
  sl?: string      // shift label
  sp?: string      // special action
  g?: number       // flex-grow
  cls?: string     // extra CSS class
  id?: string      // DOM id
  repeat?: boolean // key repeat
}

export interface ModState {
  shift: boolean
  ctrl: boolean
  alt: boolean
}
