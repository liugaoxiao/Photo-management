export type PhotoItem = {
  id: string
  asset: PHAsset
  image: UIImage | null
  loading: boolean
}

export type PointOffset = {
  x: number
  y: number
}

export type CardMotion = {
  offset: PointOffset
  scale: number
  opacity: number
}
