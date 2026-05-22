import { Trans, useLingui } from '@lingui/react/macro';
import { MenuItem } from '@szhsin/react-menu';
import type { SyntheticEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

import extractImageDescription from '../utils/extract-image-desc';
import localeCode2Text from '../utils/localeCode2Text';
import prettyBytes from '../utils/pretty-bytes';
import showToast from '../utils/show-toast';
import states from '../utils/states';
import { getCurrentInstanceConfiguration } from '../utils/store-utils';

import Icon from './icon';
import Menu2 from './menu2';
import Modal from './modal';

const { PHANPY_IMG_ALT_API_URL: IMG_ALT_API_URL } = import.meta.env as {
  PHANPY_IMG_ALT_API_URL?: string;
};

interface AttachmentLike {
  id?: string;
  type: string;
  url?: string;
  description?: string;
  size?: number;
  fileData?: BlobPart;
  fileName?: string;
  file?: File;
  [key: string]: unknown;
}

export interface MediaAttachmentProps {
  attachment: AttachmentLike;
  disabled?: boolean;
  lang?: string;
  supportedMimeTypes?: string[];
  descriptionLimit?: number;
  onDescriptionChange?: (description: string | undefined) => void;
  onRemove?: () => void;
}

interface MediaConfiguration {
  imageSizeLimit?: number;
  imageMatrixLimit?: number;
  videoSizeLimit?: number;
  videoMatrixLimit?: number;
  videoFrameRateLimit?: number;
}

interface ConfigurationWithMedia {
  mediaAttachments?: MediaConfiguration;
}

interface ImageMatrixState {
  matrix?: number;
  width?: number;
  height?: number;
}

type VideoMatrixState = ImageMatrixState;

interface MaxErrorImageSize {
  type: 'imageSizeLimit';
  details: { imageSize: number; imageSizeLimit: number };
}
interface MaxErrorVideoSize {
  type: 'videoSizeLimit';
  details: { videoSize: number; videoSizeLimit: number };
}
interface MaxErrorImageMatrix {
  type: 'imageMatrixLimit';
  details: {
    imageMatrix: number | undefined;
    imageMatrixLimit: number;
    width: number | undefined;
    height: number | undefined;
  };
}
interface MaxErrorVideoMatrix {
  type: 'videoMatrixLimit';
  details: {
    videoMatrix: number | undefined;
    videoMatrixLimit: number;
    width: number | undefined;
    height: number | undefined;
  };
}
interface MaxErrorVideoFrameRate {
  type: 'videoFrameRateLimit';
  details?: undefined;
}

type MaxError =
  | MaxErrorImageSize
  | MaxErrorVideoSize
  | MaxErrorImageMatrix
  | MaxErrorVideoMatrix
  | MaxErrorVideoFrameRate;

interface ToastHandle {
  hideToast?: () => void;
}

function scaleDimension(
  matrix: number,
  matrixLimit: number,
  width: number,
  height: number,
) {
  // matrix = number of pixels
  // matrixLimit = max number of pixels
  // Calculate new width and height, downsize to within the limit, preserve aspect ratio, no decimals
  const scalingFactor = Math.sqrt(matrixLimit / matrix);
  const newWidth = Math.floor(width * scalingFactor);
  const newHeight = Math.floor(height * scalingFactor);
  return { newWidth, newHeight };
}

function MediaAttachment({
  attachment,
  disabled,
  lang,
  supportedMimeTypes,
  descriptionLimit = 1500,
  onDescriptionChange = () => {},
  onRemove = () => {},
}: MediaAttachmentProps) {
  const { i18n, t } = useLingui();
  const [uiState, setUIState] = useState('default');
  const { type, id, fileData, fileName, file } = attachment;
  const fileSize = attachment.size ?? file?.size;
  const url = useMemo(() => {
    let objectURL;
    // Prioritize fileData so restored drafts get a fresh blob URL
    if (fileData) {
      const blob = new Blob([fileData], { type });
      objectURL = URL.createObjectURL(blob);
    } else if (file) {
      objectURL = URL.createObjectURL(file);
    }
    if (objectURL) {
      return objectURL;
    }
    return attachment.url || null;
  }, [fileData, file, attachment.url, type]);

  useEffect(() => {
    return () => {
      if (url && url !== attachment.url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url, attachment.url]);

  console.log({ attachment });

  const checkMaxError = !!fileSize;
  const configuration: ConfigurationWithMedia = checkMaxError
    ? (getCurrentInstanceConfiguration() as ConfigurationWithMedia)
    : {};
  const {
    mediaAttachments: {
      imageSizeLimit,
      imageMatrixLimit,
      videoSizeLimit,
      videoMatrixLimit,
    } = {},
  } = configuration || {};

  const [maxError, setMaxError] = useState<MaxError | null>(() => {
    if (!checkMaxError) return null;
    if (
      type.startsWith('image') &&
      imageSizeLimit &&
      fileSize !== undefined &&
      fileSize > imageSizeLimit
    ) {
      return {
        type: 'imageSizeLimit',
        details: {
          imageSize: fileSize,
          imageSizeLimit,
        },
      };
    } else if (
      type.startsWith('video') &&
      videoSizeLimit &&
      fileSize !== undefined &&
      fileSize > videoSizeLimit
    ) {
      return {
        type: 'videoSizeLimit',
        details: {
          videoSize: fileSize,
          videoSizeLimit,
        },
      };
    }
    return null;
  });

  const [imageMatrix, setImageMatrix] = useState<ImageMatrixState>({});
  useEffect(() => {
    if (!checkMaxError || !imageMatrixLimit) return;
    if ((imageMatrix?.matrix as number) > imageMatrixLimit) {
      setMaxError({
        type: 'imageMatrixLimit',
        details: {
          imageMatrix: imageMatrix?.matrix,
          imageMatrixLimit,
          width: imageMatrix?.width,
          height: imageMatrix?.height,
        },
      });
    }
  }, [imageMatrix, imageMatrixLimit, checkMaxError]);

  const [videoMatrix, setVideoMatrix] = useState<VideoMatrixState>({});
  useEffect(() => {
    if (!checkMaxError || !videoMatrixLimit) return;
    if ((videoMatrix?.matrix as number) > videoMatrixLimit) {
      setMaxError({
        type: 'videoMatrixLimit',
        details: {
          videoMatrix: videoMatrix?.matrix,
          videoMatrixLimit,
          width: videoMatrix?.width,
          height: videoMatrix?.height,
        },
      });
    }
  }, [videoMatrix, videoMatrixLimit, checkMaxError]);

  const [description, setDescription] = useState(attachment.description);

  // Snapshot the mount-time props for the metadata extraction effect below.
  // The extraction must run exactly once per attachment lifetime; later
  // changes to `description`, `id`, `file`, etc. (e.g. user edits, upload
  // completion) must not re-extract and clobber the user's input. Capturing
  // a single immutable snapshot at construction time keeps the effect's
  // dependency list literal (`[snapshot]`) and stable.
  const extractionInputsRef = useRef({
    file,
    fileData,
    fileName,
    type,
    id,
    description: attachment.description,
  });

  useEffect(() => {
    const {
      file: snapFile,
      fileData: snapFileData,
      fileName: snapFileName,
      type: snapType,
      id: snapId,
      description: snapDescription,
    } = extractionInputsRef.current;
    const hasFileData = snapFileData || snapFile;
    if (
      !hasFileData ||
      !snapType.startsWith('image/') ||
      snapId ||
      snapDescription
    ) {
      return undefined;
    }

    let cancelled = false;

    void (async () => {
      setUIState('loading');
      try {
        // Reconstruct File from fileData, or fall back to legacy file object
        const fileObj = snapFileData
          ? new File([snapFileData], snapFileName || 'upload', {
              type: snapType,
            })
          : snapFile;
        const extractedDescription = await extractImageDescription(fileObj);
        if (!cancelled && extractedDescription) {
          setDescription(extractedDescription);
        }
      } catch (error) {
        console.debug('Failed to extract image metadata:', error);
      } finally {
        if (!cancelled) {
          setUIState('default');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  let [suffixType, subtype] = type.split('/');
  // If type is not supported, try to find a supported type with the same subtype
  // E.g. application/ogg -> audio/ogg
  const suffixTypes = new Set<string>();
  const subTypeMap: Record<string, string> = {};
  if (supportedMimeTypes?.length) {
    supportedMimeTypes.forEach((mimeType) => {
      const [topType, st] = mimeType.split('/');
      subTypeMap[st] = topType;
      suffixTypes.add(topType);
    });
  }
  if (subtype && !suffixTypes.has(suffixType) && subTypeMap[subtype]) {
    suffixType = subTypeMap[subtype];
  }

  const debouncedOnDescriptionChange = useDebouncedCallback(
    onDescriptionChange,
    250,
  );
  useEffect(() => {
    debouncedOnDescriptionChange(description);
  }, [description, debouncedOnDescriptionChange]);

  const [showModal, setShowModal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const textarea = textareaRef.current;
    if (showModal && textarea) {
      timer = setTimeout(() => {
        textarea.focus();
      }, 100);
    }
    return () => {
      clearTimeout(timer);
    };
  }, [showModal]);

  const descTextarea = (
    <>
      <textarea
        ref={textareaRef}
        value={description || ''}
        lang={lang}
        placeholder={
          (
            {
              image: t`Image description`,
              video: t`Video description`,
              gifv: t`Video description`,
              audio: t`Audio description`,
            } as Record<string, string>
          )[suffixType]
        }
        autoCapitalize="sentences"
        autoComplete="on"
        autoCorrect="on"
        spellCheck={true}
        dir="auto"
        disabled={disabled || uiState === 'loading'}
        className={uiState === 'loading' ? 'loading' : ''}
        maxLength={descriptionLimit} // Not unicode-aware :(
        onInput={(e: SyntheticEvent<HTMLTextAreaElement>) => {
          const { value } = e.target as HTMLTextAreaElement;
          setDescription(value);
          // debouncedOnDescriptionChange(value);
        }}
      ></textarea>
    </>
  );

  const toastRef = useRef<ToastHandle | null>(null);
  useEffect(() => {
    return () => {
      toastRef.current?.hideToast?.();
    };
  }, []);

  const maxErrorToast = useRef<ToastHandle | null>(null);

  const maxErrorText = (err: MaxError): string => {
    switch (err.type) {
      case 'imageSizeLimit': {
        const { imageSize, imageSizeLimit: limit } = err.details;
        return t`File size too large. Uploading might encounter issues. Try reduce the file size from ${prettyBytes(
          imageSize,
        )} to ${prettyBytes(limit)} or lower.`;
      }
      case 'imageMatrixLimit': {
        const {
          imageMatrix: matrix,
          imageMatrixLimit: limit,
          width,
          height,
        } = err.details;
        const { newWidth, newHeight } = scaleDimension(
          matrix as number,
          limit,
          width as number,
          height as number,
        );
        return t`Dimension too large. Uploading might encounter issues. Try reduce dimension from ${i18n.number(
          width as number,
        )}×${i18n.number(height as number)}px to ${i18n.number(newWidth)}×${i18n.number(
          newHeight,
        )}px.`;
      }
      case 'videoSizeLimit': {
        const { videoSize, videoSizeLimit: limit } = err.details;
        return t`File size too large. Uploading might encounter issues. Try reduce the file size from ${prettyBytes(
          videoSize,
        )} to ${prettyBytes(limit)} or lower.`;
      }
      case 'videoMatrixLimit': {
        const {
          videoMatrix: matrix,
          videoMatrixLimit: limit,
          width,
          height,
        } = err.details;
        const { newWidth, newHeight } = scaleDimension(
          matrix as number,
          limit,
          width as number,
          height as number,
        );
        return t`Dimension too large. Uploading might encounter issues. Try reduce dimension from ${i18n.number(
          width as number,
        )}×${i18n.number(height as number)}px to ${i18n.number(newWidth)}×${i18n.number(
          newHeight,
        )}px.`;
      }
      case 'videoFrameRateLimit': {
        // Not possible to detect this on client-side for now
        return t`Frame rate too high. Uploading might encounter issues.`;
      }
      default:
        return '';
    }
  };

  return (
    <>
      <div className="media-attachment">
        {/* TODO(oxlint:jsx-a11y/prefer-tag-over-role): replacing the wrapping
            <div role="button"> with a <button> would nest <audio>/<video>
            elements inside a button, which breaks their built-in controls. */}
        <div
          className="media-preview"
          role="button"
          tabIndex={0}
          onClick={() => {
            setShowModal(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setShowModal(true);
            }
          }}
        >
          {suffixType === 'image' ? (
            <img
              src={url as string}
              alt=""
              onLoad={(e: SyntheticEvent<HTMLImageElement>) => {
                if (!checkMaxError) return;
                const { naturalWidth, naturalHeight } =
                  e.target as HTMLImageElement;
                setImageMatrix({
                  matrix: naturalWidth * naturalHeight,
                  width: naturalWidth,
                  height: naturalHeight,
                });
              }}
            />
          ) : suffixType === 'video' || suffixType === 'gifv' ? (
            <video
              src={url + '#t=0.1'} // Make Safari show 1st-frame preview
              playsInline
              muted
              disablePictureInPicture
              preload="metadata"
              onLoadedMetadata={(e: SyntheticEvent<HTMLVideoElement>) => {
                if (!checkMaxError) return;
                const { videoWidth, videoHeight } =
                  e.target as HTMLVideoElement;
                if (videoWidth && videoHeight) {
                  setVideoMatrix({
                    matrix: videoWidth * videoHeight,
                    width: videoWidth,
                    height: videoHeight,
                  });
                }
              }}
            />
          ) : suffixType === 'audio' ? (
            // TODO(oxlint:jsx-a11y/media-has-caption): user-uploaded
            // attachment preview; no captions track is available, and
            // emitting an empty <track> would advertise fake captions.
            <audio src={url as string} controls />
          ) : null}
        </div>
        {descTextarea}
        <div className="media-aside">
          <button
            type="button"
            className="plain close-button"
            disabled={disabled}
            onClick={onRemove}
          >
            <Icon icon="x" alt={t`Remove`} />
          </button>
          {!!maxError && (
            <button
              type="button"
              className="media-error"
              title={maxErrorText(maxError)}
              onClick={() => {
                if (maxErrorToast.current) {
                  (maxErrorToast.current.hideToast as () => void)();
                }
                maxErrorToast.current = showToast({
                  text: maxErrorText(maxError),
                  duration: 10_000,
                });
              }}
            >
              <Icon icon="alert" alt={t`Error`} />
            </button>
          )}
        </div>
      </div>
      {showModal && (
        <Modal
          onClose={() => {
            setShowModal(false);
          }}
        >
          <div id="media-sheet" className="sheet sheet-max">
            <button
              type="button"
              className="sheet-close"
              onClick={() => {
                setShowModal(false);
              }}
            >
              <Icon icon="x" alt={t`Close`} />
            </button>
            <header>
              <h2>
                {
                  (
                    {
                      image: t`Edit image description`,
                      video: t`Edit video description`,
                      gifv: t`Edit video description`,
                      audio: t`Edit audio description`,
                    } as Record<string, string>
                  )[suffixType]
                }
              </h2>
            </header>
            <main tabIndex={-1}>
              <div className="media-preview">
                {suffixType === 'image' ? (
                  <img src={url as string} alt="" />
                ) : suffixType === 'video' || suffixType === 'gifv' ? (
                  // TODO(oxlint:jsx-a11y/media-has-caption): user-uploaded
                  // attachment preview; no captions track is available,
                  // and emitting an empty <track> would advertise fake
                  // captions.
                  <video src={url as string} playsInline controls />
                ) : suffixType === 'audio' ? (
                  // TODO(oxlint:jsx-a11y/media-has-caption): user-uploaded
                  // attachment preview; no captions track is available,
                  // and emitting an empty <track> would advertise fake
                  // captions.
                  <audio src={url as string} controls />
                ) : null}
              </div>
              <div className="media-form">
                {descTextarea}
                <footer>
                  {suffixType === 'image' &&
                    /^(png|jpe?g|gif|webp)$/i.test(subtype) &&
                    states.settings.mediaAltGenerator &&
                    !!IMG_ALT_API_URL && (
                      <Menu2
                        portal={{
                          target: document.body,
                        }}
                        containerProps={{
                          style: {
                            zIndex: 1001,
                          },
                        }}
                        align="center"
                        position="anchor"
                        overflow="auto"
                        menuButton={
                          <button type="button" className="plain">
                            <Icon icon="more" size="l" alt={t`More`} />
                          </button>
                        }
                      >
                        <MenuItem
                          disabled={uiState === 'loading'}
                          onClick={() => {
                            setUIState('loading');
                            toastRef.current = showToast({
                              text: t`Generating description. Please wait…`,
                              duration: -1,
                            });
                            // POST with multipart
                            void (async function () {
                              try {
                                const body = new FormData();
                                const fileObj = fileData
                                  ? new File([fileData], fileName || 'upload', {
                                      type,
                                    })
                                  : file;
                                if (fileObj) {
                                  body.append('image', fileObj);
                                }
                                if (!IMG_ALT_API_URL) {
                                  return;
                                }
                                const response = await fetch(IMG_ALT_API_URL, {
                                  method: 'POST',
                                  body,
                                }).then((r) => r.json());
                                if (response.error) {
                                  throw new Error(response.error);
                                }
                                setDescription(response.description);
                              } catch (e) {
                                console.error(e);
                                const err = e as { message?: string };
                                showToast(
                                  err.message
                                    ? t`Failed to generate description: ${err.message}`
                                    : t`Failed to generate description`,
                                );
                              } finally {
                                setUIState('default');
                                toastRef.current?.hideToast?.();
                              }
                            })();
                          }}
                        >
                          <Icon icon="sparkles2" />
                          {lang && lang !== 'en' ? (
                            <small>
                              <Trans>Generate description…</Trans>
                              <br />
                              (English)
                            </small>
                          ) : (
                            <span>
                              <Trans>Generate description…</Trans>
                            </span>
                          )}
                        </MenuItem>
                        {!!lang && lang !== 'en' && (
                          <MenuItem
                            disabled={uiState === 'loading'}
                            onClick={() => {
                              setUIState('loading');
                              toastRef.current = showToast({
                                text: t`Generating description. Please wait…`,
                                duration: -1,
                              });
                              // POST with multipart
                              void (async function () {
                                try {
                                  const body = new FormData();
                                  const fileObj = fileData
                                    ? new File(
                                        [fileData],
                                        fileName || 'upload',
                                        { type },
                                      )
                                    : file;
                                  if (fileObj) {
                                    body.append('image', fileObj);
                                  }
                                  if (!IMG_ALT_API_URL) {
                                    return;
                                  }
                                  const params = `?lang=${lang}`;
                                  const response = await fetch(
                                    IMG_ALT_API_URL + params,
                                    {
                                      method: 'POST',
                                      body,
                                    },
                                  ).then((r) => r.json());
                                  if (response.error) {
                                    throw new Error(response.error);
                                  }
                                  setDescription(response.description);
                                } catch (e) {
                                  console.error(e);
                                  const err = e as { message?: string } | null;
                                  showToast(
                                    t`Failed to generate description${
                                      err?.message ? `: ${err.message}` : ''
                                    }`,
                                  );
                                } finally {
                                  setUIState('default');
                                  toastRef.current?.hideToast?.();
                                }
                              })();
                            }}
                          >
                            <Icon icon="sparkles2" />
                            <small>
                              <Trans>Generate description…</Trans>
                              <br />
                              <Trans>
                                ({localeCode2Text(lang)}){' '}
                                <span className="more-insignificant">
                                  — experimental
                                </span>
                              </Trans>
                            </small>
                          </MenuItem>
                        )}
                      </Menu2>
                    )}
                  <button
                    type="button"
                    className="light block"
                    onClick={() => {
                      setShowModal(false);
                    }}
                    disabled={uiState === 'loading'}
                  >
                    <Trans>Done</Trans>
                  </button>
                </footer>
              </div>
            </main>
          </div>
        </Modal>
      )}
    </>
  );
}

export default MediaAttachment;
