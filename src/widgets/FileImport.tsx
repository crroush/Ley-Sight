export function FileImport({
  label = 'Import file',
  accept,
  onFiles,
}: {
  label?: string
  accept?: string
  onFiles: (files: FileList) => void
}) {
  return (
    <label>
      {label}
      <input
        type="file"
        accept={accept}
        onChange={(event) => {
          if (event.currentTarget.files) onFiles(event.currentTarget.files)
        }}
      />
    </label>
  )
}
