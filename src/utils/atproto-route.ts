function encodeAtprotoID(id: string): string {
  return encodeURIComponent(id);
}

function decodeAtprotoID(id: string): string {
  return decodeURIComponent(id);
}

export { decodeAtprotoID, encodeAtprotoID };
