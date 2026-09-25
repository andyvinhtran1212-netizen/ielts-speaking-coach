# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Mock Reading native player | Existing prestart while bridge/attach settles | Existing no-attempt state | Answering starts only after persisted attach succeeds | Existing error state on timeout/rejection; reload resumes the saved attempt | Existing sitting admission applies | Preserve 390/768/1440 layouts, both themes, keyboard focus and reduced motion |
| Mock Listening native player | Existing prestart while bridge/attach settles | Existing no-attempt state | Start and resume reveal the attempt only after attach | Existing error state on timeout/rejection; reload resumes the saved attempt | Existing sitting admission applies | Preserve 390/768/1440 layouts, both themes, keyboard focus and reduced motion |

The backend attempt-to-sitting link is canonical. A pending or failed attach
must not produce an answerable player; a full reload reads the persisted
attempt and repeats the attach gate.
