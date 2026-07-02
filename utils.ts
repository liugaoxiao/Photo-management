import {
  cardWidth,
  maxRightInteractiveLift,
  screenWidth,
  trashTargetOffset,
} from "./constants"
import type { CardMotion, PointOffset } from "./types"

export function formatDate(timestamp: number | null): string {
  if (!timestamp) return "未知时间"

  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")

  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function nextCardOpacity(offset: PointOffset): number {
  const distance = Math.abs(offset.x)
  return Math.min(1, 0.52 + distance / 260)
}

export function nextCardScale(offset: PointOffset): number {
  const distance = Math.abs(offset.x)
  return Math.min(1, 0.955 + distance / 2400)
}

export function nextCardOffsetY(offset: PointOffset): number {
  const distance = Math.abs(offset.x)
  return Math.max(0, 12 - distance / 22)
}

export function interactiveMotion(translation: PointOffset): CardMotion {
  const rightDistance = Math.max(0, translation.x)
  const rightProgress = Math.max(0, Math.min(1, rightDistance / 360))
  const leftProgress = Math.max(0, Math.min(1, -translation.x / 180))

  if (translation.x > 0) {
    const scale = Math.max(0.52, 1 - rightProgress * 0.46)
    const maxOffsetBeforeRightEdgeLeavesScreen = Math.max(
      0,
      (screenWidth - cardWidth * scale) / 2
    )
    const desiredOffsetX = rightDistance * 0.58

    return {
      offset: {
        x: Math.min(desiredOffsetX, maxOffsetBeforeRightEdgeLeavesScreen),
        y: -rightProgress * maxRightInteractiveLift + translation.y * 0.03,
      },
      scale,
      opacity: Math.max(0.58, 1 - rightProgress * 0.32),
    }
  }

  return {
    offset: {
      x: translation.x,
      y: translation.y * 0.08,
    },
    scale: Math.max(0.9, 1 - leftProgress * 0.08),
    opacity: Math.max(0.76, 1 - leftProgress * 0.18),
  }
}

export function trashFlightMotion(_currentOffset: PointOffset): CardMotion {
  return {
    offset: trashTargetOffset,
    scale: 0.035,
    opacity: 0,
  }
}
