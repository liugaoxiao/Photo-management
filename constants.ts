export const FETCH_LIMIT = 200
export const SWIPE_THRESHOLD = 96
export const CARD_CORNER_RADIUS = 22

export const screenWidth = Device.screen.width
export const screenHeight = Device.screen.height
export const cardWidth = Math.min(screenWidth - 40, 420)
export const cardHeight = Math.max(340, Math.min(screenHeight - 340, 520))
export const photoAreaHeight = cardHeight + 34

export const trashTargetOffset = {
  x: screenWidth * 0.42,
  y: -screenHeight * 0.58,
}

export const maxRightInteractiveLift = Math.min(screenHeight * 0.34, 260)

export const skipTargetOffset = {
  x: -screenWidth * 0.86,
  y: 0,
}
