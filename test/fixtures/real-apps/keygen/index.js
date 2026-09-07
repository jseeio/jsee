function arrayBufferToBase64(arr) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(arr)))
}

function arrayBufferToBase64String(arrayBuffer) {
  var byteArray = new Uint8Array(arrayBuffer)
  var byteString = ''
  for (var i=0; i<byteArray.byteLength; i++) {
    byteString += String.fromCharCode(byteArray[i])
  }
  return btoa(byteString)
}


function convertBinaryToPem(binaryData, label) {
  var base64Cert = arrayBufferToBase64String(binaryData)
  var pemCert = "-----BEGIN " + label + "-----\r\n"
  var nextIndex = 0
  var lineLength
  while (nextIndex < base64Cert.length) {
    if (nextIndex + 64 <= base64Cert.length) {
      pemCert += base64Cert.substr(nextIndex, 64) + "\r\n"
    } else {
      pemCert += base64Cert.substr(nextIndex) + "\r\n"
    }
    nextIndex += 64
  }
  pemCert += "-----END " + label + "-----\r\n"
  return pemCert
}

async function keygen(optionsBase) {
  const defaults = {
    length: 4096,
		hash: 'SHA-256',
  }
  const options = Object.assign({}, defaults, optionsBase)

  const keys = await window.crypto.subtle.generateKey(
    {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: options['length'], //can be 1024, 2048, or 4096
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: {name: options['hash']}, //can be "SHA-1", "SHA-256", "SHA-384", or "SHA-512"
    },
    true, //whether the key is extractable (i.e. can be used in exportKey)
    ["sign", "verify"] //can be any combination of "sign" and "verify"
  )
	
	const publicKeyBin = await window.crypto.subtle.exportKey('spki', keys.publicKey)
  const publicKey = await convertBinaryToPem(publicKeyBin, "RSA PUBLIC KEY")

  const privateKeyBin = await window.crypto.subtle.exportKey('pkcs8', keys.privateKey)
  const privateKey = await convertBinaryToPem(privateKeyBin, "RSA PRIVATE KEY")

  return {
		'Public key': publicKey,
		'Private key': privateKey
	}
}
