export type LogLevel = 'info' | 'ok' | 'warn' | 'err'

export interface LogEvent {
  id: number
  time: string
  level: LogLevel
  text: string
}
