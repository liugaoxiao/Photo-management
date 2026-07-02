import {
  HStack,
  ZStack,
  VStack,
  Text,
  Image,
  ProgressView,
  Spacer,
} from "scripting"
import { CARD_CORNER_RADIUS, cardHeight, cardWidth } from "../constants"
import type { PhotoItem, PointOffset } from "../types"
import { formatDate, nextCardOffsetY, nextCardOpacity, nextCardScale } from "../utils"

type PhotoCardStackProps = {
  currentItem: PhotoItem
  nextItem?: PhotoItem
  remainingCount: number
  dragOffset: PointOffset
  cardScale: number
  cardOpacity: number
  onDragChanged: (value: any) => void
  onDragEnded: (value: any) => void
}

function PhotoImageCard({
  image,
  scaleEffect,
  offset,
  opacity,
  shadowOpacity,
  zIndex,
}: {
  image: UIImage | null
  scaleEffect: number
  offset: PointOffset
  opacity: number
  shadowOpacity: number
  zIndex: number
}) {
  return (
    <ZStack
      frame={{ width: cardWidth, height: cardHeight }}
      background="thinMaterial"
      clipShape={{ type: "rect", cornerRadius: CARD_CORNER_RADIUS, style: "continuous" }}
      shadow={{ color: "separator", radius: 22, y: 10 }}
      offset={offset}
      scaleEffect={scaleEffect}
      opacity={opacity}
      zIndex={zIndex}
      allowsHitTesting={false}
    >
      {image ? (
        <Image
          image={image}
          resizable
          scaleToFit
          frame={{ width: cardWidth, height: cardHeight }}
          background="ultraThinMaterial"
          clipShape={{ type: "rect", cornerRadius: CARD_CORNER_RADIUS, style: "continuous" }}
          allowsHitTesting={false}
        />
      ) : (
        <VStack spacing={10}>
          <ProgressView />
          <Text font={13} foregroundStyle="tertiaryLabel">
            正在准备下一张…
          </Text>
        </VStack>
      )}
    </ZStack>
  )
}

function FixedGestureLayer({
  onDragChanged,
  onDragEnded,
}: {
  onDragChanged: (value: any) => void
  onDragEnded: (value: any) => void
}) {
  return (
    <ZStack
      frame={{ width: cardWidth, height: cardHeight }}
      background="clear"
      contentShape={{ type: "rect", cornerRadius: CARD_CORNER_RADIUS, style: "continuous" }}
      onDragGesture={{
        minDistance: 3,
        coordinateSpace: "local",
        onChanged: onDragChanged,
        onEnded: onDragEnded,
      }}
      zIndex={10}
    />
  )
}

export function PhotoCardStack({
  currentItem,
  nextItem,
  remainingCount,
  dragOffset,
  cardScale,
  cardOpacity,
  onDragChanged,
  onDragEnded,
}: PhotoCardStackProps) {
  return (
    <VStack spacing={16}>
      <ZStack frame={{ width: cardWidth, height: cardHeight }}>
        <PhotoImageCard
          image={nextItem?.image ?? null}
          scaleEffect={nextCardScale(dragOffset)}
          offset={{ x: 0, y: nextCardOffsetY(dragOffset) }}
          opacity={nextCardOpacity(dragOffset)}
          shadowOpacity={0.1}
          zIndex={1}
        />

        <PhotoImageCard
          image={currentItem.image}
          scaleEffect={cardScale}
          offset={dragOffset}
          opacity={cardOpacity}
          shadowOpacity={0.16}
          zIndex={2}
        />

        <FixedGestureLayer
          onDragChanged={onDragChanged}
          onDragEnded={onDragEnded}
        />
      </ZStack>

      <HStack
        spacing={10}
        frame={{ maxWidth: cardWidth }}
        padding={{ horizontal: 18, vertical: 12 }}
        background="thinMaterial"
        clipShape={{ type: "rect", cornerRadius: 20, style: "continuous" }}
        shadow={{ color: "separator", radius: 10, y: 4 }}
      >
        <Image systemName="calendar" imageScale="small" foregroundStyle="systemBlue" />
        <Text font={13} fontWeight="medium" foregroundStyle="secondaryLabel">
          {formatDate(currentItem.asset.creationDate)}
        </Text>
        <Spacer />
        <Text font={12} fontWeight="semibold" foregroundStyle="systemBlue">
          剩余 {remainingCount} 张
        </Text>
      </HStack>
    </VStack>
  )
}
