import {
  Script,
  Navigation,
  NavigationStack,
  ZStack,
  VStack,
  HStack,
  Text,
  Image,
  Spacer,
  Button,
  ForEach,
  List,
  ProgressView,
  ScrollView,
  Toolbar,
  ToolbarItem,
  useEffect,
  useRef,
  useObservable,
  useState,
} from "scripting"
import { PhotoCardStack } from "./components/PhotoCardStack"
import {
  SWIPE_THRESHOLD,
  cardHeight,
  cardWidth,
  photoAreaHeight,
  skipTargetOffset,
} from "./constants"
import type { PhotoItem, PointOffset } from "./types"
import { interactiveMotion, trashFlightMotion } from "./utils"

const initialOffset: PointOffset = { x: 0, y: 0 }
const ALBUM_ORDER_STORAGE_KEY = "photo-manager.album-order"
const PROCESSED_PHOTOS_STORAGE_KEY = "photo-manager.processed-photo-ids"
const MAX_PROCESSED_PHOTO_IDS = 20000
const PREFETCH_PHOTO_COUNT = 100

function getProcessedPhotoIds() {
  const ids = Storage.get<string[]>(PROCESSED_PHOTOS_STORAGE_KEY) ?? []
  return ids.filter(Boolean)
}

function saveProcessedPhotoIds(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids)).slice(-MAX_PROCESSED_PHOTO_IDS)
  Storage.set(PROCESSED_PHOTOS_STORAGE_KEY, uniqueIds)
}

function markPhotoAsProcessed(id: string) {
  const ids = getProcessedPhotoIds().filter(photoId => photoId !== id)
  saveProcessedPhotoIds([...ids, id])
}

function unmarkPhotoAsProcessed(id: string) {
  saveProcessedPhotoIds(getProcessedPhotoIds().filter(photoId => photoId !== id))
}

function getPrefetchIndexes(startIndex: number) {
  return Array.from({ length: PREFETCH_PHOTO_COUNT }, (_, offset) => startIndex + offset)
}

type OperationRecord = {
  id: string
  action: "delete" | "skip" | "album"
}

type AlbumOption = {
  id: string
  title: string
  count: number
  collection: PHAssetCollection
}

function App() {
  const dismiss = Navigation.useDismiss()

  const [items, setItems] = useState<PhotoItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])
  const [operationHistory, setOperationHistory] = useState<OperationRecord[]>([])
  const [dragOffset, setDragOffset] = useState<PointOffset>(initialOffset)
  const [cardScale, setCardScale] = useState(1)
  const [cardOpacity, setCardOpacity] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [isThrowing, setIsThrowing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isAlbumManagerOpen, setIsAlbumManagerOpen] = useState(false)
  const [albums, setAlbums] = useState<AlbumOption[]>([])
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null)
  const [sortingAlbumId, setSortingAlbumId] = useState<string | null>(null)
  const [dragSortOffsetY, setDragSortOffsetY] = useState(0)
  const [isAlbumBusy, setIsAlbumBusy] = useState(false)
  const [albumStatusMessage, setAlbumStatusMessage] = useState("")
  const [message, setMessage] = useState("")
  const [showToast, setShowToast] = useState(false)
  const sortableAlbums = useObservable<AlbumOption[]>([])
  const albumEditMode = useObservable(() => EditMode.active())
  const lastPhotoDragAt = useRef(0)

  const currentItem = items[currentIndex]
  const nextItem = items[currentIndex + 1]
  const remainingCount = Math.max(items.length - currentIndex, 0)
  const isEmpty = !isLoading && items.length === 0
  const isFinished = !isLoading && items.length > 0 && currentIndex >= items.length
  const canUndo = operationHistory.length > 0 && !isThrowing && !isDeleting
  const selectedAlbum = albums.find(album => album.id === selectedAlbumId) ?? null
  const progressText = isLoading
    ? "正在读取照片…"
    : isFinished
      ? "全部照片已浏览完"
      : `${Math.min(currentIndex + 1, items.length)} / ${items.length}`

  function toast(text: string) {
    setMessage(text)
    setShowToast(true)
  }

  function resetCardState() {
    lastPhotoDragAt.current = 0
    setDragOffset(initialOffset)
    setCardScale(1)
    setCardOpacity(1)
  }

  async function loadImagesForIndexes(sourceItems: PhotoItem[], indexes: number[]) {
    const validIndexes = indexes.filter(index => index >= 0 && index < sourceItems.length)
    if (validIndexes.length === 0) return

    const nextItems = [...sourceItems]
    let changed = false

    for (const index of validIndexes) {
      const item = nextItems[index]
      if (!item || item.image || item.loading) continue

      nextItems[index] = {
        ...item,
        loading: true,
      }
      changed = true
    }

    if (changed) {
      setItems(nextItems)
    }

    for (const index of validIndexes) {
      const item = nextItems[index]
      if (!item || item.image) continue

      let image: UIImage | null = null
      try {
        image = await item.asset.requestImage({
          targetWidth: Math.round(cardWidth * Device.screen.scale),
          targetHeight: Math.round(cardHeight * Device.screen.scale),
          contentMode: "aspectFit",
          deliveryMode: "highQualityFormat",
          allowNetworkAccess: true,
        })
      } catch (error) {
        console.error(error)
      }

      setItems(list => {
        const copy = [...list]
        const current = copy[index]
        if (!current || current.id !== item.id) return list

        copy[index] = {
          ...current,
          image,
          loading: false,
        }
        return copy
      })
    }
  }

  async function loadPhotos() {
    setIsLoading(true)

    try {
      const status = Photos.authorizationStatus("readWrite")
      if (status === "denied" || status === "restricted") {
        toast("没有照片访问权限，请在系统设置中允许访问照片。")
        setIsLoading(false)
        return
      }

      const processedPhotoIdSet = new Set(getProcessedPhotoIds())
      const assets = await Photos.fetchAssets({
        mediaType: "image",
        sortBy: "creationDate",
        ascending: false,
        limit: 0,
      })

      const photoItems = assets
        .filter(asset => !processedPhotoIdSet.has(asset.localIdentifier))
        .map<PhotoItem>(asset => ({
          id: asset.localIdentifier,
          asset,
          image: null,
          loading: false,
        }))

      setItems(photoItems)
      setCurrentIndex(0)
      setPendingDeleteIds([])
      setOperationHistory([])
      resetCardState()
      setIsLoading(false)

      loadImagesForIndexes(photoItems, getPrefetchIndexes(0))
    } catch (error) {
      console.error(error)
      setIsLoading(false)
      toast("读取照片失败，请稍后重试。")
    }
  }

  useEffect(() => {
    loadPhotos()
  }, [])

  useEffect(() => {
    loadImagesForIndexes(items, getPrefetchIndexes(currentIndex))
  }, [currentIndex])

  async function throwCurrentToTrash() {
    if (!currentItem || isThrowing || isDeleting) return

    const handledPhotoId = currentItem.id
    setIsThrowing(true)

    const flight = trashFlightMotion(dragOffset)
    await withAnimation(
      Animation.easeIn(0.44),
      () => {
        setDragOffset(flight.offset)
        setCardScale(flight.scale)
        setCardOpacity(flight.opacity)
      }
    )

    setPendingDeleteIds(ids => {
      if (ids.includes(handledPhotoId)) return ids
      return [...ids, handledPhotoId]
    })
    markPhotoAsProcessed(handledPhotoId)
    setOperationHistory(history => [...history, { id: handledPhotoId, action: "delete" }])
    loadImagesForIndexes(items, getPrefetchIndexes(currentIndex + 1))

    resetCardState()
    setCurrentIndex(index => index + 1)
    setIsThrowing(false)
  }

  async function skipCurrentPhoto() {
    if (!currentItem || isThrowing || isDeleting) return

    const handledPhotoId = currentItem.id
    setIsThrowing(true)

    await withAnimation(
      Animation.easeOut(0.26),
      () => {
        setDragOffset(skipTargetOffset)
        setCardScale(0.92)
        setCardOpacity(0)
      }
    )

    resetCardState()
    setOperationHistory(history => [...history, { id: handledPhotoId, action: "skip" }])
    loadImagesForIndexes(items, getPrefetchIndexes(currentIndex + 1))
    setCurrentIndex(index => index + 1)
    setIsThrowing(false)
  }

  function undoLastOperation() {
    if (!canUndo) return

    const last = operationHistory[operationHistory.length - 1]
    setOperationHistory(history => history.slice(0, -1))

    if (last.action !== "skip") {
      unmarkPhotoAsProcessed(last.id)
    }

    if (last.action === "delete") {
      setPendingDeleteIds(ids => ids.filter(id => id !== last.id))
    }

    resetCardState()
    setCurrentIndex(index => Math.max(index - 1, 0))
  }

  function resetDrag() {
    withAnimation(Animation.spring({ response: 0.28, dampingFraction: 0.82 }), resetCardState)
  }

  async function deletePendingPhotos() {
    if (isDeleting) return

    if (pendingDeleteIds.length === 0) {
      toast("暂无待删除照片，先右滑图片加入垃圾箱。")
      return
    }

    setIsDeleting(true)

    try {
      const idsToDelete = [...pendingDeleteIds]
      const assets = await Photos.fetchAssets(idsToDelete)
      if (assets.length === 0) {
        setPendingDeleteIds([])
        toast("待删除照片已不存在。")
        setIsDeleting(false)
        return
      }

      const ok = await Photos.deleteAssets(assets)
      if (!ok) {
        toast("已取消删除，待删除队列仍保留。")
        setIsDeleting(false)
        return
      }

      const deletedSet = new Set(idsToDelete)

      setItems(list => {
        const filtered = list.filter(item => !deletedSet.has(item.id))
        setCurrentIndex(index => Math.min(index, Math.max(filtered.length - 1, 0)))
        return filtered
      })
      setPendingDeleteIds([])
      setOperationHistory([])
      toast(`已删除 ${idsToDelete.length} 张照片。`)
    } catch (error) {
      console.error(error)
      toast("删除失败，请稍后重试。")
    } finally {
      setIsDeleting(false)
    }
  }

  function handleDragChanged(value: any) {
    if (isThrowing || isDeleting || !currentItem) return

    const now = Date.now()
    if (now - lastPhotoDragAt.current < 12) return
    lastPhotoDragAt.current = now

    const motion = interactiveMotion({
      x: value.translation.width,
      y: value.translation.height,
    })
    setDragOffset(motion.offset)
    setCardScale(motion.scale)
    setCardOpacity(motion.opacity)
  }

  function handleDragEnded(value: any) {
    if (isThrowing || isDeleting || !currentItem) return

    const shouldDelete =
      value.translation.width > SWIPE_THRESHOLD ||
      value.predictedEndTranslation.width > SWIPE_THRESHOLD * 1.35
    const shouldSkip =
      value.translation.width < -SWIPE_THRESHOLD ||
      value.predictedEndTranslation.width < -SWIPE_THRESHOLD * 1.35

    if (shouldDelete) {
      throwCurrentToTrash()
    } else if (shouldSkip) {
      skipCurrentPhoto()
    } else {
      resetDrag()
    }
  }

  async function loadAlbums() {
    try {
      const fetchedAlbums = await Photos.fetchAlbums({ type: "album" })
      const savedOrder = Storage.get<string[]>(ALBUM_ORDER_STORAGE_KEY) ?? []
      const orderMap = new Map(savedOrder.map((id, index) => [id, index]))
      const userAlbums = fetchedAlbums
        .filter(album => album.subtype === "albumRegular")
        .map<AlbumOption>(album => ({
          id: album.localIdentifier,
          title: album.title ?? "未命名相簿",
          count: Math.max(album.estimatedAssetCount, 0),
          collection: album,
        }))
        .sort((a, b) => {
          const aOrder = orderMap.get(a.id)
          const bOrder = orderMap.get(b.id)
          if (aOrder != null && bOrder != null) return aOrder - bOrder
          if (aOrder != null) return -1
          if (bOrder != null) return 1
          return a.title.localeCompare(b.title, "zh-Hans")
        })

      setAlbums(userAlbums)
      sortableAlbums.setValue(userAlbums)
      setSelectedAlbumId(currentId => {
        if (currentId && userAlbums.some(album => album.id === currentId)) return currentId
        return userAlbums[0]?.id ?? null
      })
    } catch (error) {
      console.error(error)
      toast("读取相簿失败，请稍后重试。")
    }
  }

  async function toggleAlbumManager() {
    const willOpen = !isAlbumManagerOpen
    withAnimation(
      Animation.spring({ response: 0.26, dampingFraction: 0.86 }),
      () => setIsAlbumManagerOpen(willOpen)
    )
    if (!willOpen) {
      finishAlbumSorting()
    }
    if (willOpen) {
      setAlbumStatusMessage("")
      await loadAlbums()
    }
  }

  async function createNewAlbum() {
    if (isAlbumBusy) return

    const title = await Dialog.prompt({
      title: "新建相簿",
      message: "输入要添加的相簿名称。",
      placeholder: "例如：待整理、旅行、工作截图",
      cancelLabel: "取消",
      confirmLabel: "添加",
    })
    const trimmedTitle = title?.trim()
    if (!trimmedTitle) return

    setIsAlbumBusy(true)
    try {
      const album = await Photos.createAlbum(trimmedTitle)
      if (!album) {
        toast("新建相簿失败，请稍后重试。")
        return
      }

      await loadAlbums()
      setSelectedAlbumId(album.localIdentifier)
      setAlbumStatusMessage(`已添加相簿「${trimmedTitle}」`)
    } catch (error) {
      console.error(error)
      toast("新建相簿失败，请稍后重试。")
    } finally {
      setIsAlbumBusy(false)
    }
  }

  useEffect(() => {
    if (!sortingAlbumId || sortableAlbums.value.length === 0) return
    Storage.set(ALBUM_ORDER_STORAGE_KEY, sortableAlbums.value.map(album => album.id))
  }, [sortableAlbums.value, sortingAlbumId])

  function startAlbumSorting(album: AlbumOption) {
    if (isAlbumBusy) return

    if (sortableAlbums.value.length === 0) {
      sortableAlbums.setValue(albums)
    }
    withAnimation(
      Animation.spring({ response: 0.24, dampingFraction: 0.9 }),
      () => {
        setSortingAlbumId(album.id)
        setDragSortOffsetY(0)
      }
    )
  }

  function finishAlbumSorting() {
    if (sortableAlbums.value.length > 0) {
      setAlbums(sortableAlbums.value)
      Storage.set(ALBUM_ORDER_STORAGE_KEY, sortableAlbums.value.map(album => album.id))
    }
    withAnimation(
      Animation.easeOut(0.18),
      () => {
        setSortingAlbumId(null)
        setDragSortOffsetY(0)
      }
    )
  }

  async function handleAlbumTap(album: AlbumOption) {
    if (isAlbumBusy) return

    if (sortingAlbumId) {
      setSortingAlbumId(album.id)
      setDragSortOffsetY(0)
      return
    }

    await addCurrentPhotoToAlbum(album)
  }

  async function addCurrentPhotoToAlbum(album: AlbumOption) {
    if (!currentItem || isThrowing || isDeleting || isAlbumBusy) {
      if (!currentItem) toast("当前没有可加入相簿的照片。")
      return
    }

    const handledPhotoId = currentItem.id

    setSelectedAlbumId(album.id)
    setAlbumStatusMessage("")
    setIsAlbumBusy(true)
    try {
      const ok = await album.collection.addAssets([currentItem.asset])
      if (!ok) {
        toast("加入相簿失败，请稍后重试。")
        return
      }

      setAlbumStatusMessage(`已加入「${album.title}」，自动切换下一张`)
      markPhotoAsProcessed(handledPhotoId)
      setOperationHistory(history => [...history, { id: handledPhotoId, action: "album" }])
      loadImagesForIndexes(items, getPrefetchIndexes(currentIndex + 1))
      resetCardState()
      setCurrentIndex(index => index + 1)
      loadAlbums()
    } catch (error) {
      console.error(error)
      toast("加入相簿失败，请稍后重试。")
    } finally {
      setIsAlbumBusy(false)
    }
  }

  function renderAlbumSortPanel() {
    if (!sortingAlbumId || albums.length === 0) return null

    const sortingAlbums = sortableAlbums.value.length > 0 ? sortableAlbums.value : albums

    return (
      <VStack
        spacing={8}
        frame={{ width: 350 }}
        padding={{ horizontal: 12, vertical: 10 }}
        background="regularMaterial"
        clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}
        shadow={{ color: "rgba(0,0,0,0.22)", radius: 22, y: 10 }}
        offset={{ x: 0, y: isAlbumManagerOpen ? 96 : 0 }}
        zIndex={100}
      >
        <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
          <Text font={13} fontWeight="semibold" foregroundStyle="systemOrange" frame={{ maxWidth: "infinity" }}>
            相簿编辑
          </Text>
          <Button title="完成" action={finishAlbumSorting} buttonStyle="bordered" />
        </HStack>

        <List
          frame={{ height: 320 }}
          environments={{ editMode: albumEditMode }}
          background="ultraThinMaterial"
          scrollContentBackground="hidden"
          listStyle="plain"
        >
          <ForEach
            data={sortableAlbums}
            editActions="move"
            builder={(album, index) => {
              const isSortingSource = album.id === sortingAlbumId
              return (
                <HStack
                  key={album.id}
                  spacing={9}
                  frame={{ maxWidth: "infinity" }}
                  onTapGesture={() => setSortingAlbumId(album.id)}
                >
                  <Text font={12} fontWeight="semibold" foregroundStyle={isSortingSource ? "systemOrange" : "tertiaryLabel"} frame={{ width: 24 }}>
                    {index + 1}
                  </Text>
                  <Image systemName={isSortingSource ? "folder.fill" : "folder"} imageScale="small" foregroundStyle={isSortingSource ? "systemOrange" : "secondaryLabel"} />
                  <Text font={14} fontWeight={isSortingSource ? "semibold" : "medium"} foregroundStyle={isSortingSource ? "systemOrange" : "label"} frame={{ maxWidth: "infinity" }} lineLimit={1}>
                    {album.title}
                  </Text>
                </HStack>
              )
            }}
          />
        </List>

        <Text font={11} foregroundStyle="tertiaryLabel" multilineTextAlignment="center">
          长按进入后已处于编辑状态，拖动右侧三条杠即可调整顺序。
        </Text>
      </VStack>
    )
  }

  function renderAlbumManager() {
    if (!isAlbumManagerOpen) return null

    const sortingAlbum = albums.find(album => album.id === sortingAlbumId) ?? null

    return (
      <VStack
        spacing={14}
        frame={{ maxWidth: "infinity" }}
        padding={{ horizontal: 14, vertical: 14 }}
        background="thinMaterial"
        clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}
      >
        <HStack spacing={10} frame={{ maxWidth: "infinity" }}>
          <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity" }}>
            <Text font={16} fontWeight="semibold" foregroundStyle="label">
              相簿管理
            </Text>
            <Text font={13} foregroundStyle={albumStatusMessage ? "systemGreen" : "secondaryLabel"}>
              {sortingAlbum ? `正在拖动排序：${sortingAlbum.title}` : albumStatusMessage || (selectedAlbum ? `当前选择：${selectedAlbum.title}` : "添加或选择相簿")}
            </Text>
          </VStack>
          <Button title="+ 添加" action={() => createNewAlbum()} disabled={isAlbumBusy} buttonStyle="bordered" />
        </HStack>

        {albums.length === 0 ? (
          <Text font={14} foregroundStyle="tertiaryLabel" multilineTextAlignment="center">
            暂无可写入的自建相簿，点“添加”创建一个。
          </Text>
        ) : (
          <ScrollView axes="horizontal">
            <HStack spacing={12}>
              {albums.map(album => {
                const isSelected = album.id === selectedAlbumId
                const isSortingSource = album.id === sortingAlbumId
                return (
                  <HStack spacing={8}
                    key={album.id}
                    padding={{ horizontal: 18, vertical: 13 }}
                    background={isSortingSource ? "regularMaterial" : isSelected ? "thinMaterial" : "ultraThinMaterial"}
                    clipShape={{ type: "rect", cornerRadius: 999, style: "continuous" }}
                    opacity={isAlbumBusy ? 0.55 : 1}
                    onTapGesture={() => handleAlbumTap(album)}
                    onLongPressGesture={{
                      minDuration: 350,
                      perform: () => startAlbumSorting(album),
                    }}
                  >
                    <Image systemName={isSortingSource ? "folder.fill" : isSelected ? "folder.fill" : "folder"} imageScale="medium" foregroundStyle={isSortingSource ? "systemOrange" : isSelected ? "systemBlue" : "secondaryLabel"} />
                    <Text font={16} fontWeight={isSortingSource || isSelected ? "semibold" : "medium"} foregroundStyle={isSortingSource ? "systemOrange" : isSelected ? "systemBlue" : "secondaryLabel"}>
                      {album.title}
                    </Text>
                  </HStack>
                )
              })}
            </HStack>
          </ScrollView>
        )}
      </VStack>
    )
  }

  function renderTrashLabel() {
    return (
      <HStack spacing={5}>
        <Image
          systemName={pendingDeleteIds.length > 0 ? "trash.fill" : "trash"}
          renderingMode="template"
          foregroundStyle={pendingDeleteIds.length > 0 ? "systemRed" : "systemBlue"}
        />
        {pendingDeleteIds.length > 0 ? (
          <Text font={14} fontWeight="semibold" foregroundStyle="systemRed">
            {pendingDeleteIds.length}
          </Text>
        ) : null}
      </HStack>
    )
  }

  return (
    <NavigationStack>
      <ZStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background="ultraThinMaterial"
        navigationTitle=""
        navigationBarTitleDisplayMode="inline"
        toolbar={
          <Toolbar>
            <ToolbarItem placement="topBarLeading">
              <Button title="关闭" action={dismiss} />
            </ToolbarItem>
            <ToolbarItem placement="topBarTrailing">
              <Button action={() => deletePendingPhotos()} disabled={isDeleting}>
                {renderTrashLabel()}
              </Button>
            </ToolbarItem>
          </Toolbar>
        }
        toast={{
          message,
          isPresented: showToast,
          onChanged: setShowToast,
          position: "bottom",
        }}
      >
        <VStack
          spacing={12}
          frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          padding={{ horizontal: 14, top: 10, bottom: 14 }}
        >
          <HStack
            spacing={10}
            frame={{ maxWidth: "infinity" }}
            padding={{ horizontal: 14, vertical: 10 }}
            background="thinMaterial"
            clipShape={{ type: "rect", cornerRadius: 18, style: "continuous" }}
            shadow={{ color: "rgba(0,0,0,0.08)", radius: 12, y: 4 }}
          >
            <VStack alignment="center" spacing={5} frame={{ maxWidth: "infinity" }}>
              <Text font={17} fontWeight="bold" foregroundStyle="label" multilineTextAlignment="center">
                全部照片
              </Text>
              <Text font={12} fontWeight="medium" foregroundStyle="secondaryLabel" multilineTextAlignment="center">
                Photo editing · {progressText}
              </Text>
            </VStack>
          </HStack>

          <ZStack frame={{ maxWidth: "infinity", height: photoAreaHeight }}>
            <ZStack
              frame={{ maxWidth: "infinity", height: photoAreaHeight }}
              background="regularMaterial"
              clipShape={{ type: "rect", cornerRadius: 30, style: "continuous" }}
              shadow={{ color: "rgba(0,0,0,0.18)", radius: 18, y: 10 }}
              allowsHitTesting={false}
            />
            {isLoading ? (
              <VStack spacing={12}>
                <ProgressView />
                <Text font={15} foregroundStyle="white">正在载入全部照片</Text>
              </VStack>
            ) : isEmpty ? (
              <VStack spacing={12} padding={28}>
                <Image systemName="photo.on.rectangle.angled" imageScale="large" foregroundStyle="white" />
                <Text font={20} fontWeight="semibold" foregroundStyle="white">
                  没有找到照片
                </Text>
                <Text font={14} foregroundStyle="rgba(255,255,255,0.68)" multilineTextAlignment="center">
                  没有找到未处理照片。
                </Text>
              </VStack>
            ) : isFinished ? (
              <VStack spacing={14} padding={28}>
                <Image systemName="checkmark.circle.fill" imageScale="large" foregroundStyle="systemGreen" />
                <Text font={22} fontWeight="bold" foregroundStyle="white">
                  浏览完成
                </Text>
                <Text font={14} foregroundStyle="rgba(255,255,255,0.72)" multilineTextAlignment="center">
                  已放入垃圾箱 {pendingDeleteIds.length} 张。点击右上角垃圾箱可统一删除。
                </Text>
                <Button title="重新读取" action={() => loadPhotos()} buttonStyle="borderedProminent" />
              </VStack>
            ) : currentItem?.image ? (
              <PhotoCardStack
                currentItem={currentItem}
                nextItem={nextItem}
                remainingCount={remainingCount}
                dragOffset={dragOffset}
                cardScale={cardScale}
                cardOpacity={cardOpacity}
                onDragChanged={handleDragChanged}
                onDragEnded={handleDragEnded}
              />
            ) : (
              <VStack spacing={12}>
                <ProgressView />
                <Text font={15} foregroundStyle="white">正在准备图片…</Text>
              </VStack>
            )}
          </ZStack>

          <VStack
            spacing={10}
            frame={{ maxWidth: "infinity" }}
            padding={{ horizontal: 14, vertical: 12 }}
            background="regularMaterial"
            clipShape={{ type: "rect", cornerRadius: 24, style: "continuous" }}
            shadow={{ color: "rgba(0,0,0,0.10)", radius: 16, y: 6 }}
          >
            <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
              <Button action={() => undoLastOperation()} disabled={!canUndo} frame={{ maxWidth: "infinity" }}>
                <VStack spacing={5} frame={{ maxWidth: "infinity" }}>
                  <ZStack
                    frame={{ width: 48, height: 48 }}
                    background={canUndo ? "thinMaterial" : "ultraThinMaterial"}
                    clipShape={{ type: "rect", cornerRadius: 999, style: "continuous" }}
                  >
                    <Image
                      systemName="arrow.uturn.backward"
                      imageScale="medium"
                      foregroundStyle={canUndo ? "systemGreen" : "tertiaryLabel"}
                    />
                  </ZStack>
                  <Text font={10} fontWeight="medium" foregroundStyle={canUndo ? "systemGreen" : "tertiaryLabel"}>撤回</Text>
                </VStack>
              </Button>

              <Button action={() => skipCurrentPhoto()} disabled={!currentItem || isThrowing || isDeleting} frame={{ maxWidth: "infinity" }}>
                <VStack spacing={5} frame={{ maxWidth: "infinity" }}>
                  <ZStack
                    frame={{ width: 48, height: 48 }}
                    background="thinMaterial"
                    clipShape={{ type: "rect", cornerRadius: 999, style: "continuous" }}
                  >
                    <Image systemName="arrow.left" imageScale="medium" foregroundStyle="systemBlue" />
                  </ZStack>
                  <Text font={10} fontWeight="medium" foregroundStyle="secondaryLabel">跳过</Text>
                </VStack>
              </Button>

              <Button action={() => throwCurrentToTrash()} disabled={!currentItem || isThrowing || isDeleting} frame={{ maxWidth: "infinity" }}>
                <VStack spacing={5} frame={{ maxWidth: "infinity" }}>
                  <ZStack
                    frame={{ width: 48, height: 48 }}
                    background="thickMaterial"
                    clipShape={{ type: "rect", cornerRadius: 999, style: "continuous" }}
                    shadow={{ color: "rgba(255,59,48,0.35)", radius: 12, y: 5 }}
                  >
                    <Image systemName="trash.fill" imageScale="medium" foregroundStyle="systemRed" />
                  </ZStack>
                  <Text font={10} fontWeight="medium" foregroundStyle="systemRed">删除</Text>
                </VStack>
              </Button>

              <Button action={() => toggleAlbumManager()} disabled={isLoading || isDeleting} frame={{ maxWidth: "infinity" }}>
                <VStack spacing={5} frame={{ maxWidth: "infinity" }}>
                  <ZStack
                    frame={{ width: 48, height: 48 }}
                    background={isAlbumManagerOpen ? "thinMaterial" : "ultraThinMaterial"}
                    clipShape={{ type: "rect", cornerRadius: 999, style: "continuous" }}
                  >
                    <Image systemName="folder.badge.plus" imageScale="medium" foregroundStyle={isAlbumManagerOpen ? "systemBlue" : "secondaryLabel"} />
                  </ZStack>
                  <Text font={10} fontWeight="medium" foregroundStyle={isAlbumManagerOpen ? "systemBlue" : "secondaryLabel"}>相簿</Text>
                </VStack>
              </Button>
            </HStack>
            {renderAlbumManager()}
            <Text font={12} foregroundStyle="tertiaryLabel" multilineTextAlignment="center">
              左滑跳过，右滑或点删除加入垃圾箱；点相簿可将当前照片存入对应相簿，并自动切换下一张。
            </Text>
          </VStack>
        </VStack>

        {renderAlbumSortPanel()}
      </ZStack>
    </NavigationStack>
  )
}

async function run() {
  await Navigation.present({
    element: <App />,
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

run()
