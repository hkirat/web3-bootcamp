'use strict';

function decode_arithmetic(bytes) {
	let pos = 0;
	function u16() { return (bytes[pos++] << 8) | bytes[pos++]; }
	
	// decode the frequency table
	let symbol_count = u16();
	let total = 1;
	let acc = [0, 1]; // first symbol has frequency 1
	for (let i = 1; i < symbol_count; i++) {
		acc.push(total += u16());
	}

	// skip the sized-payload that the last 3 symbols index into
	let skip = u16();
	let pos_payload = pos;
	pos += skip;

	let read_width = 0;
	let read_buffer = 0; 
	function read_bit() {
		if (read_width == 0) {
			// this will read beyond end of buffer
			// but (undefined|0) => zero pad
			read_buffer = (read_buffer << 8) | bytes[pos++];
			read_width = 8;
		}
		return (read_buffer >> --read_width) & 1;
	}

	const N = 31;
	const FULL = 2**N;
	const HALF = FULL >>> 1;
	const QRTR = HALF >> 1;
	const MASK = FULL - 1;

	// fill register
	let register = 0;
	for (let i = 0; i < N; i++) register = (register << 1) | read_bit();

	let symbols = [];
	let low = 0;
	let range = FULL; // treat like a float
	while (true) {
		let value = Math.floor((((register - low + 1) * total) - 1) / range);
		let start = 0;
		let end = symbol_count;
		while (end - start > 1) { // binary search
			let mid = (start + end) >>> 1;
			if (value < acc[mid]) {
				end = mid;
			} else {
				start = mid;
			}
		}
		if (start == 0) break; // first symbol is end mark
		symbols.push(start);
		let a = low + Math.floor(range * acc[start]   / total);
		let b = low + Math.floor(range * acc[start+1] / total) - 1;
		while (((a ^ b) & HALF) == 0) {
			register = (register << 1) & MASK | read_bit();
			a = (a << 1) & MASK;
			b = (b << 1) & MASK | 1;
		}
		while (a & ~b & QRTR) {
			register = (register & HALF) | ((register << 1) & (MASK >>> 1)) | read_bit();
			a = (a << 1) ^ HALF;
			b = ((b ^ HALF) << 1) | HALF | 1;
		}
		low = a;
		range = 1 + b - a;
	}
	let offset = symbol_count - 4;
	return symbols.map(x => { // index into payload
		switch (x - offset) {
			case 3: return offset + 0x10100 + ((bytes[pos_payload++] << 16) | (bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 2: return offset + 0x100 + ((bytes[pos_payload++] << 8) | bytes[pos_payload++]);
			case 1: return offset + bytes[pos_payload++];
			default: return x - 1;
		}
	});
}	

// returns an iterator which returns the next symbol
function read_payload(v) {
	let pos = 0;
	return () => v[pos++];
}
function read_compressed_payload(s) {
	return read_payload(decode_arithmetic(unsafe_atob(s)));
}

// unsafe in the sense:
// expected well-formed Base64 w/o padding 
// 20220922: added for https://github.com/adraffy/ens-normalize.js/issues/4
function unsafe_atob(s) {
	let lookup = [];
	[...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].forEach((c, i) => lookup[c.charCodeAt(0)] = i);
	let n = s.length;
	let ret = new Uint8Array((6 * n) >> 3);
	for (let i = 0, pos = 0, width = 0, carry = 0; i < n; i++) {
		carry = (carry << 6) | lookup[s.charCodeAt(i)];
		width += 6;
		if (width >= 8) {
			ret[pos++] = (carry >> (width -= 8));
		}
	}
	return ret;
}

// eg. [0,1,2,3...] => [0,-1,1,-2,...]
function signed(i) { 
	return (i & 1) ? (~i >> 1) : (i >> 1);
}

function read_deltas(n, next) {
	let v = Array(n);
	for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
	return v;
}

// [123][5] => [0 3] [1 1] [0 0]
function read_sorted(next, prev = 0) {
	let ret = [];
	while (true) {
		let x = next();
		let n = next();
		if (!n) break;
		prev += x;
		for (let i = 0; i < n; i++) {
			ret.push(prev + i);
		}
		prev += n + 1;
	}
	return ret;
}

function read_sorted_arrays(next) {
	return read_array_while(() => { 
		let v = read_sorted(next);
		if (v.length) return v;
	});
}

// returns map of x => ys
function read_mapped(next) {
	let ret = [];
	while (true) {
		let w = next();
		if (w == 0) break;
		ret.push(read_linear_table(w, next));
	}
	while (true) {
		let w = next() - 1;
		if (w < 0) break;
		ret.push(read_replacement_table(w, next));
	}
	return ret.flat();
}

// read until next is falsy
// return array of read values
function read_array_while(next) {
	let v = [];
	while (true) {
		let x = next(v.length);
		if (!x) break;
		v.push(x);
	}
	return v;
}

// read w columns of length n
// return as n rows of length w
function read_transposed(n, w, next) {
	let m = Array(n).fill().map(() => []);
	for (let i = 0; i < w; i++) {
		read_deltas(n, next).forEach((x, j) => m[j].push(x));
	}
	return m;
}
 
// returns [[x, ys], [x+dx, ys+dy], [x+2*dx, ys+2*dy], ...]
// where dx/dy = steps, n = run size, w = length of y
function read_linear_table(w, next) {
	let dx = 1 + next();
	let dy = next();
	let vN = read_array_while(next);
	let m = read_transposed(vN.length, 1+w, next);
	return m.flatMap((v, i) => {
		let [x, ...ys] = v;
		return Array(vN[i]).fill().map((_, j) => {
			let j_dy = j * dy;
			return [x + j * dx, ys.map(y => y + j_dy)];
		});
	});
}

// return [[x, ys...], ...]
// where w = length of y
function read_replacement_table(w, next) { 
	let n = 1 + next();
	let m = read_transposed(n, 1+w, next);
	return m.map(v => [v[0], v.slice(1)]);
}


function read_trie(next) {
	let ret = [];
	let sorted = read_sorted(next); 
	expand(decode([]), []);
	return ret; // not sorted
	function decode(Q) { // characters that lead into this node
		let S = next(); // state: valid, save, check
		let B = read_array_while(() => { // buckets leading to new nodes
			let cps = read_sorted(next).map(i => sorted[i]);
			if (cps.length) return decode(cps);
		});
		return {S, B, Q};
	}
	function expand({S, B}, cps, saved) {
		if (S & 4 && saved === cps[cps.length-1]) return;
		if (S & 2) saved = cps[cps.length-1];
		if (S & 1) ret.push(cps); 
		for (let br of B) {
			for (let cp of br.Q) {
				expand(br, [...cps, cp], saved);
			}
		}
	}
}

// created 2023-07-20T07:23:23.727Z
// compressed base64-encoded blob for include-ens data
// source: https://github.com/adraffy/ens-normalize.js/blob/main/src/make.js
// see: https://github.com/adraffy/ens-normalize.js#security
// SHA-256: 4aab629147f0d7e715ffac2cd3e2fcd0e6922ee059b78d717c265540d3bf5768
var r$1 = read_compressed_payload('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');
const FENCED = new Map([[8217,"apostrophe"],[8260,"fraction slash"],[12539,"middle dot"]]);
const NSM_MAX = 4;

function hex_cp(cp) {
	return cp.toString(16).toUpperCase().padStart(2, '0');
}

function quote_cp(cp) {
	return `{${hex_cp(cp)}}`; // raffy convention: like "\u{X}" w/o the "\u"
}

/*
export function explode_cp(s) {
	return [...s].map(c => c.codePointAt(0));
}
*/
function explode_cp(s) { // this is about 2x faster
	let cps = [];
	for (let pos = 0, len = s.length; pos < len; ) {
		let cp = s.codePointAt(pos);
		pos += cp < 0x10000 ? 1 : 2;
		cps.push(cp);
	}
	return cps;
}

function str_from_cps(cps) {
	const chunk = 4096;
	let len = cps.length;
	if (len < chunk) return String.fromCodePoint(...cps);
	let buf = [];
	for (let i = 0; i < len; ) {
		buf.push(String.fromCodePoint(...cps.slice(i, i += chunk)));
	}
	return buf.join('');
}

function compare_arrays(a, b) {
	let n = a.length;
	let c = n - b.length;
	for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
	return c;
}

// created 2023-07-20T07:23:23.727Z
// compressed base64-encoded blob for include-nf data
// source: https://github.com/adraffy/ens-normalize.js/blob/main/src/make.js
// see: https://github.com/adraffy/ens-normalize.js#security
// SHA-256: a974b6f8541fc29d919bc85118af0a44015851fab5343f8679cb31be2bdb209e
var r = read_compressed_payload('AEUDTAHBCFQATQDRADAAcgAgADQAFAAsABQAHwAOACQADQARAAoAFwAHABIACAAPAAUACwAFAAwABAAQAAMABwAEAAoABQAIAAIACgABAAQAFAALAAIACwABAAIAAQAHAAMAAwAEAAsADAAMAAwACgANAA0AAwAKAAkABAAdAAYAZwDSAdsDJgC0CkMB8xhZAqfoC190UGcThgBurwf7PT09Pb09AjgJum8OjDllxHYUKXAPxzq6tABAxgK8ysUvWAgMPT09PT09PSs6LT2HcgWXWwFLoSMEEEl5RFVMKvO0XQ8ExDdJMnIgsj26PTQyy8FfEQ8AY8IPAGcEbwRwBHEEcgRzBHQEdQR2BHcEeAR6BHsEfAR+BIAEgfndBQoBYgULAWIFDAFiBNcE2ATZBRAFEQUvBdALFAsVDPcNBw13DYcOMA4xDjMB4BllHI0B2grbAMDpHLkQ7QHVAPRNQQFnGRUEg0yEB2uaJF8AJpIBpob5AERSMAKNoAXqaQLUBMCzEiACnwRZEkkVsS7tANAsBG0RuAQLEPABv9HICTUBXigPZwRBApMDOwAamhtaABqEAY8KvKx3LQ4ArAB8UhwEBAVSagD8AEFZADkBIadVj2UMUgx5Il4ANQC9AxIB1BlbEPMAs30CGxlXAhwZKQIECBc6EbsCoxngzv7UzRQA8M0BawL6ZwkN7wABAD33OQRcsgLJCjMCjqUChtw/km+NAsXPAoP2BT84PwURAK0RAvptb6cApQS/OMMey5HJS84UdxpxTPkCogVFITaTOwERAK5pAvkNBOVyA7q3BKlOJSALAgUIBRcEdASpBXqzABXFSWZOawLCOqw//AolCZdvv3dSBkEQGyelEPcMMwG1ATsN7UvYBPEGOwTJH30ZGQ/NlZwIpS3dDO0m4y6hgFoj9SqDBe1L9DzdC01RaA9ZC2UJ4zpjgU4DIQENIosK3Q05CG0Q8wrJaw3lEUUHOQPVSZoApQcBCxEdNRW1JhBirAsJOXcG+xr2C48mrxMpevwF0xohBk0BKRr/AM8u54WwWjFcHE9fBgMLJSPHFKhQIA0lQLd4SBobBxUlqQKRQ3BKh1E2HpMh9jw9DWYuE1F8B/U8BRlPC4E8nkarRQ4R0j6NPUgiSUwsBDV/LC8niwnPD4UMuXxyAVkJIQmxDHETMREXN8UIOQcZLZckJxUIIUaVYJoE958D8xPRAwsFPwlBBxMDtRwtEy4VKQUNgSTXAvM21S6zAo9WgAEXBcsPJR/fEFBH4A7pCJsCZQODJesALRUhABcimwhDYwBfj9hTBS7LCMdqbCN0A2cU52ERcweRDlcHpxwzFb8c4XDIXguGCCijrwlbAXUJmQFfBOMICTVbjKAgQWdTi1gYmyBhQT9d/AIxDGUVn0S9h3gCiw9rEhsBNQFzBzkNAQJ3Ee0RaxCVCOuGBDW1M/g6JQRPIYMgEQonA09szgsnJvkM+GkBoxJiAww0PXfuZ6tgtiQX/QcZMsVBYCHxC5JPzQycGsEYQlQuGeQHvwPzGvMn6kFXBf8DowMTOk0z7gS9C2kIiwk/AEkOoxcH1xhqCnGM0AExiwG3mQNXkYMCb48GNwcLAGcLhwV55QAdAqcIowAFAM8DVwA5Aq0HnQAZAIVBAT0DJy8BIeUCjwOTCDHLAZUvAfMpBBvDDBUA9zduSgLDsQKAamaiBd1YAo4CSTUBTSUEBU5HUQOvceEA2wBLBhPfRwEVq0rLGuNDAd9vKwDHAPsABTUHBUEBzQHzbQC3AV8LMQmis7UBTekpAIMAFWsB1wKJAN0ANQB/8QFTAE0FWfkF0wJPSQERMRgrV2EBuwMfATMBDQB5BsuNpckHHwRtB9MCEBsV4QLvLge1AQMi3xPNQsUCvd5VoWACZIECYkJbTa9bNyACofcCaJgCZgkCn4Q4GwsCZjsCZiYEbgR/A38TA36SOQY5dxc5gjojIwJsHQIyNjgKAm3HAm2u74ozZ0UrAWcA3gDhAEoFB5gMjQD+C8IADbUCdy8CdqI/AnlLQwJ4uh1c20WuRtcCfD8CesgCfQkCfPAFWQUgSABIfWMkAoFtAoAAAoAFAn+uSVhKWxUXSswC0QEC0MxLJwOITwOH5kTFkTIC8qFdAwMDrkvOTC0lA89NTE2vAos/AorYwRsHHUNnBbcCjjcCjlxAl4ECjtkCjlx4UbRTNQpS1FSFApP7ApMMAOkAHFUeVa9V0AYsGymVhjLheGZFOzkCl58C77JYIagAWSUClo8ClnycAKlZrFoJgU0AOwKWtQKWTlxEXNECmcsCmWRcyl0HGQKcmznCOp0CnBYCn5sCnriKAB0PMSoPAp3xAp6SALU9YTRh7wKe0wKgbgGpAp6fHwKeTqVjyGQnJSsCJ68CJn4CoPsCoEwCot0CocQCpi8Cpc4Cp/8AfQKn8mh8aLEAA0lqHGrRAqzjAqyuAq1nAq0CAlcdAlXcArHh1wMfTmyXArK9DQKy6Bds4G1jbUhfAyXNArZcOz9ukAMpRQK4XgK5RxUCuSp3cDZw4QK9GQK72nCWAzIRAr6IcgIDM3ECvhpzInNPAsPLAsMEc4J0SzVFdOADPKcDPJoDPb8CxXwCxkcCxhCJAshpUQLIRALJTwLJLgJknQLd0nh5YXiueSVL0AMYo2cCAmH0GfOVJHsLXpJeuxECz2sCz2wvS1PS8xOfAMatAs9zASnqA04SfksFAtwnAtuKAtJPA1JcA1NfAQEDVYyAiT8AyxbtYEWCHILTgs6DjQLaxwLZ3oQQhEmnPAOGpQAvA2QOhnFZ+QBVAt9lAt64c3cC4i/tFAHzMCcB9JsB8tKHAuvzAulweQLq+QLq5AD5RwG5Au6JAuuclqqXAwLuPwOF4Jh5cOBxoQLzAwBpA44WmZMC9xMDkW4DkocC95gC+dkC+GaaHJqruzebHgOdgwL++gEbADmfHJ+zAwWNA6ZqA6bZANHFAwZqoYiiBQkDDEkCwAA/AwDhQRdTARHzA2sHl2cFAJMtK7evvdsBiZkUfxEEOQH7KQUhDp0JnwCS/SlXxQL3AZ0AtwW5AG8LbUEuFCaNLgFDAYD8AbUmAHUDDgRtACwCFgyhAAAKAj0CagPdA34EkQEgRQUhfAoABQBEABMANhICdwEABdUDa+8KxQIA9wqfJ7+xt+UBkSFBQgHpFH8RNMCJAAQAGwBaAkUChIsABjpTOpSNbQC4Oo860ACNOME63AClAOgAywE6gTo7Ofw5+Tt2iTpbO56JOm85GAFWATMBbAUvNV01njWtNWY1dTW2NcU1gjWRNdI14TWeNa017jX9NbI1wTYCNhE1xjXVNhY2JzXeNe02LjY9Ni41LSE2OjY9Njw2yTcIBJA8VzY4Nt03IDcPNsogN4k3MAoEsDxnNiQ3GTdsOo03IULUQwdC4EMLHA8PCZsobShRVQYA6X8A6bABFCnXAukBowC9BbcAbwNzBL8MDAMMAQgDAAkKCwsLCQoGBAVVBI/DvwDz9b29kaUCb0QtsRTNLt4eGBcSHAMZFhYZEhYEARAEBUEcQRxBHEEcQRxBHEEaQRxBHEFCSTxBPElISUhBNkM2QTYbNklISVmBVIgBFLWZAu0BhQCjBcEAbykBvwGJAaQcEZ0ePCklMAAhMvAIMAL54gC7Bm8EescjzQMpARQpKgDUABavAj626xQAJP0A3etzuf4NNRA7efy2Z9NQrCnC0OSyANz5BBIbJ5IFDR6miIavYS6tprjjmuKebxm5C74Q225X1pkaYYPb6f1DK4k3xMEBb9S2WMjEibTNWhsRJIA+vwNVEiXTE5iXs/wezV66oFLfp9NZGYW+Gk19J2+bCT6Ye2w6LDYdgzKMUabk595eLBCXANz9HUpWbATq9vqXVx9XDg+Pc9Xp4+bsS005SVM/BJBM4687WUuf+Uj9dEi8aDNaPxtpbDxcG1THTImUMZq4UCaaNYpsVqraNyKLJXDYsFZ/5jl7bLRtO88t7P3xZaAxhb5OdPMXqsSkp1WCieG8jXm1U99+blvLlXzPCS+M93VnJCiK+09LfaSaBAVBomyDgJua8dfUzR7ga34IvR2Nvj+A9heJ6lsl1KG4NkI1032Cnff1m1wof2B9oHJK4bi6JkEdSqeNeiuo6QoZZincoc73/TH9SXF8sCE7XyuYyW8WSgbGFCjPV0ihLKhdPs08Tx82fYAkLLc4I2wdl4apY7GU5lHRFzRWJep7Ww3wbeA3qmd59/86P4xuNaqDpygXt6M85glSBHOCGgJDnt+pN9bK7HApMguX6+06RZNjzVmcZJ+wcUrJ9//bpRNxNuKpNl9uFds+S9tdx7LaM5ZkIrPj6nIU9mnbFtVbs9s/uLgl8MVczAwet+iOEzzBlYW7RCMgE6gyNLeq6+1tIx4dpgZnd0DksJS5f+JNDpwwcPNXaaVspq1fbQajOrJgK0ofKtJ1Ne90L6VO4MOl5S886p7u6xo7OLjG8TGL+HU1JXGJgppg4nNbNJ5nlzSpuPYy21JUEcUA94PoFiZfjZue+QnyQ80ekOuZVkxx4g+cvhJfHgNl4hy1/a6+RKcKlar/J29y//EztlbVPHVUeQ1zX86eQVAjR/M3dA9w4W8LfaXp4EgM85wOWasli837PzVMOnsLzR+k3o75/lRPAJSE1xAKQzEi5v10ke+VBvRt1cwQRMd+U5mLCTGVd6XiZtgBG5cDi0w22GKcVNvHiu5LQbZEDVtz0onn7k5+heuKXVsZtSzilkLRAUmjMXEMB3J9YC50XBxPiz53SC+EhnPl9WsKCv92SM/OFFIMJZYfl0WW8tIO3UxYcwdMAj7FSmgrsZ2aAZO03BOhP1bNNZItyXYQFTpC3SG1VuPDqH9GkiCDmE+JwxyIVSO5siDErAOpEXFgjy6PQtOVDj+s6e1r8heWVvmZnTciuf4EiNZzCAd7SOMhXERIOlsHIMG399i9aLTy3m2hRLZjJVDNLS53iGIK11dPqQt0zBDyg6qc7YqkDm2M5Ve6dCWCaCbTXX2rToaIgz6+zh4lYUi/+6nqcFMAkQJKHYLK0wYk5N9szV6xihDbDDFr45lN1K4aCXBq/FitPSud9gLt5ZVn+ZqGX7cwm2z5EGMgfFpIFyhGGuDPmso6TItTMwny+7uPnLCf4W6goFQFV0oQSsc9VfMmVLcLr6ZetDZbaSFTLqnSO/bIPjA3/zAUoqgGFAEQS4IhuMzEp2I3jJzbzkk/IEmyax+rhZTwd6f+CGtwPixu8IvzACquPWPREu9ZvGkUzpRwvRRuaNN6cr0W1wWits9ICdYJ7ltbgMiSL3sTPeufgNcVqMVWFkCPDH4jG2jA0XcVgQj62Cb29v9f/z/+2KbYvIv/zzjpQAPkliaVDzNrW57TZ/ZOyZD0nlfMmAIBIAGAI0D3k/mdN4xr9v85ZbZbbqfH2jGd5hUqNZWwl5SPfoGmfElmazUIeNL1j/mkF7VNAzTq4jNt8JoQ11NQOcmhprXoxSxfRGJ9LDEOAQ+dmxAQH90iti9e2u/MoeuaGcDTHoC+xsmEeWmxEKefQuIzHbpw5Tc5cEocboAD09oipWQhtTO1wivf/O+DRe2rpl/E9wlrzBorjJsOeG1B/XPW4EaJEFdNlECEZga5ZoGRHXgYouGRuVkm8tDESiEyFNo+3s5M5puSdTyUL2llnINVHEt91XUNW4ewdMgJ4boJfEyt/iY5WXqbA+A2Fkt5Z0lutiWhe9nZIyIUjyXDC3UsaG1t+eNx6z4W/OYoTB7A6x+dNSTOi9AInctbESqm5gvOLww7OWXPrmHwVZasrl4eD113pm+JtT7JVOvnCXqdzzdTRHgJ0PiGTFYW5Gvt9R9LD6Lzfs0v/TZZHSmyVNq7viIHE6DBK7Qp07Iz55EM8SYtQvZf/obBniTWi5C2/ovHfw4VndkE5XYdjOhCMRjDeOEfXeN/CwfGduiUIfsoFeUxXeQXba7c7972XNv8w+dTjjUM0QeNAReW+J014dKAD/McQYXT7c0GQPIkn3Ll6R7gGjuiQoZD0TEeEqQpKoZ15g/0OPQI17QiSv9AUROa/V/TQN3dvLArec3RrsYlvBm1b8LWzltdugsC50lNKYLEp2a+ZZYqPejULRlOJh5zj/LVMyTDvwKhMxxwuDkxJ1QpoNI0OTWLom4Z71SNzI9TV1iXJrIu9Wcnd+MCaAw8o1jSXd94YU/1gnkrC9BUEOtQvEIQ7g0i6h+KL2JKk8Ydl7HruvgWMSAmNe+LshGhV4qnWHhO9/RIPQzY1tHRj2VqOyNsDpK0cww+56AdDC4gsWwY0XxoucIWIqs/GcwnWqlaT0KPr8mbK5U94/301i1WLt4YINTVvCFBrFZbIbY8eycOdeJ2teD5IfPLCRg7jjcFTwlMFNl9zdh/o3E/hHPwj7BWg0MU09pPrBLbrCgm54A6H+I6v27+jL5gkjWg/iYdks9jbfVP5y/n0dlgWEMlKasl7JvFZd56LfybW1eeaVO0gxTfXZwD8G4SI116yx7UKVRgui6Ya1YpixqXeNLc8IxtAwCU5IhwQgn+NqHnRaDv61CxKhOq4pOX7M6pkA+Pmpd4j1vn6ACUALoLLc4vpXci8VidLxzm7qFBe7s+quuJs6ETYmnpgS3LwSZxPIltgBDXz8M1k/W2ySNv2f9/NPhxLGK2D21dkHeSGmenRT3Yqcdl0m/h3OYr8V+lXNYGf8aCCpd4bWjE4QIPj7vUKN4Nrfs7ML6Y2OyS830JCnofg/k7lpFpt4SqZc5HGg1HCOrHvOdC8bP6FGDbE/VV0mX4IakzbdS/op+Kt3G24/8QbBV7y86sGSQ/vZzU8FXs7u6jIvwchsEP2BpIhW3G8uWNwa3HmjfH/ZjhhCWvluAcF+nMf14ClKg5hGgtPLJ98ueNAkc5Hs2WZlk2QHvfreCK1CCGO6nMZVSb99VM/ajr8WHTte9JSmkXq/i/U943HEbdzW6Re/S88dKgg8pGOLlAeNiqrcLkUR3/aClFpMXcOUP3rmETcWSfMXZE3TUOi8i+fqRnTYLflVx/Vb/6GJ7eIRZUA6k3RYR3iFSK9c4iDdNwJuZL2FKz/IK5VimcNWEqdXjSoxSgmF0UPlDoUlNrPcM7ftmA8Y9gKiqKEHuWN+AZRIwtVSxye2Kf8rM3lhJ5XcBXU9n4v0Oy1RU2M+4qM8AQPVwse8ErNSob5oFPWxuqZnVzo1qB/IBxkM3EVUKFUUlO3e51259GgNcJbCmlvrdjtoTW7rChm1wyCKzpCTwozUUEOIcWLneRLgMXh+SjGSFkAllzbGS5HK7LlfCMRNRDSvbQPjcXaenNYxCvu2Qyznz6StuxVj66SgI0T8B6/sfHAJYZaZ78thjOSIFumNWLQbeZixDCCC+v0YBtkxiBB3jefHqZ/dFHU+crbj6OvS1x/JDD7vlm7zOVPwpUC01nhxZuY/63E7g');

// https://unicode.org/reports/tr15/
// for reference implementation
// see: /derive/nf.js


function unpack_cc(packed) {
	return (packed >> 24) & 0xFF;
}
function unpack_cp(packed) {
	return packed & 0xFFFFFF;
}

const SHIFTED_RANK = new Map(read_sorted_arrays(r).flatMap((v, i) => v.map(x => [x, (i+1) << 24]))); // pre-shifted
const EXCLUSIONS = new Set(read_sorted(r));
const DECOMP = new Map();
const RECOMP = new Map();
for (let [cp, cps] of read_mapped(r)) {
	if (!EXCLUSIONS.has(cp) && cps.length == 2) {
		let [a, b] = cps;
		let bucket = RECOMP.get(a);
		if (!bucket) {
			bucket = new Map();
			RECOMP.set(a, bucket);
		}
		bucket.set(b, cp);
	}
	DECOMP.set(cp, cps.reverse()); // stored reversed
}

// algorithmic hangul
// https://www.unicode.org/versions/Unicode15.0.0/ch03.pdf (page 144)
const S0 = 0xAC00;
const L0 = 0x1100;
const V0 = 0x1161;
const T0 = 0x11A7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;
const S1 = S0 + S_COUNT;
const L1 = L0 + L_COUNT;
const V1 = V0 + V_COUNT;
const T1 = T0 + T_COUNT;

function is_hangul(cp) {
	return cp >= S0 && cp < S1;
}

function compose_pair(a, b) {
	if (a >= L0 && a < L1 && b >= V0 && b < V1) {
		return S0 + (a - L0) * N_COUNT + (b - V0) * T_COUNT;
	} else if (is_hangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
		return a + (b - T0);
	} else {
		let recomp = RECOMP.get(a);
		if (recomp) {
			recomp = recomp.get(b);
			if (recomp) {
				return recomp;
			}
		}
		return -1;
	}
}

function decomposed(cps) {
	let ret = [];
	let buf = [];
	let check_order = false;
	function add(cp) {
		let cc = SHIFTED_RANK.get(cp);
		if (cc) {
			check_order = true;
			cp |= cc;
		}
		ret.push(cp);
	}
	for (let cp of cps) {
		while (true) {
			if (cp < 0x80) {
				ret.push(cp);
			} else if (is_hangul(cp)) {
				let s_index = cp - S0;
				let l_index = s_index / N_COUNT | 0;
				let v_index = (s_index % N_COUNT) / T_COUNT | 0;
				let t_index = s_index % T_COUNT;
				add(L0 + l_index);
				add(V0 + v_index);
				if (t_index > 0) add(T0 + t_index);
			} else {
				let mapped = DECOMP.get(cp);
				if (mapped) {
					buf.push(...mapped);
				} else {
					add(cp);
				}
			}
			if (!buf.length) break;
			cp = buf.pop();
		}
	}
	if (check_order && ret.length > 1) {
		let prev_cc = unpack_cc(ret[0]);
		for (let i = 1; i < ret.length; i++) {
			let cc = unpack_cc(ret[i]);
			if (cc == 0 || prev_cc <= cc) {
				prev_cc = cc;
				continue;
			}
			let j = i-1;
			while (true) {
				let tmp = ret[j+1];
				ret[j+1] = ret[j];
				ret[j] = tmp;
				if (!j) break;
				prev_cc = unpack_cc(ret[--j]);
				if (prev_cc <= cc) break;
			}
			prev_cc = unpack_cc(ret[i]);
		}
	}
	return ret;
}

function composed_from_decomposed(v) {
	let ret = [];
	let stack = [];
	let prev_cp = -1;
	let prev_cc = 0;
	for (let packed of v) {
		let cc = unpack_cc(packed);
		let cp = unpack_cp(packed);
		if (prev_cp == -1) {
			if (cc == 0) {
				prev_cp = cp;
			} else {
				ret.push(cp);
			}
		} else if (prev_cc > 0 && prev_cc >= cc) {
			if (cc == 0) {
				ret.push(prev_cp, ...stack);
				stack.length = 0;
				prev_cp = cp;
			} else {
				stack.push(cp);
			}
			prev_cc = cc;
		} else {
			let composed = compose_pair(prev_cp, cp);
			if (composed >= 0) {
				prev_cp = composed;
			} else if (prev_cc == 0 && cc == 0) {
				ret.push(prev_cp);
				prev_cp = cp;
			} else {
				stack.push(cp);
				prev_cc = cc;
			}
		}
	}
	if (prev_cp >= 0) {
		ret.push(prev_cp, ...stack);	
	}
	return ret;
}

// note: cps can be iterable
function nfd(cps) {
	return decomposed(cps).map(unpack_cp);
}
function nfc(cps) {
	return composed_from_decomposed(decomposed(cps));
}

//console.time('init');

const STOP = 0x2E;
const FE0F = 0xFE0F;
const STOP_CH = '.';
const UNIQUE_PH = 1;
const HYPHEN = 0x2D;

function read_set() {
	return new Set(read_sorted(r$1));
}
const MAPPED = new Map(read_mapped(r$1)); 
const IGNORED = read_set(); // ignored characters are not valid, so just read raw codepoints
/*
// direct include from payload is smaller that the decompression code
const FENCED = new Map(read_array_while(() => {
	let cp = r();
	if (cp) return [cp, read_str(r())];
}));
*/
// 20230217: we still need all CM for proper error formatting
// but norm only needs NSM subset that are potentially-valid
const CM = read_set();
const NSM = new Set(read_sorted(r$1).map(function(i) { return this[i]; }, [...CM]));
/*
const CM_SORTED = read_sorted(r);
const NSM = new Set(read_sorted(r).map(i => CM_SORTED[i]));
const CM = new Set(CM_SORTED);
*/
const ESCAPE = read_set(); // characters that should not be printed
const NFC_CHECK = read_set();
const CHUNKS = read_sorted_arrays(r$1);
function read_chunked() {
	// deduplicated sets + uniques
	return new Set([read_sorted(r$1).map(i => CHUNKS[i]), read_sorted(r$1)].flat(2));
}
const UNRESTRICTED = r$1();
const GROUPS = read_array_while(i => {
	// minifier property mangling seems unsafe
	// so these are manually renamed to single chars
	let N = read_array_while(r$1).map(x => x+0x60);
	if (N.length) {
		let R = i >= UNRESTRICTED; // first arent restricted
		N[0] -= 32; // capitalize
		N = str_from_cps(N);
		if (R) N=`Restricted[${N}]`;
		let P = read_chunked(); // primary
		let Q = read_chunked(); // secondary
		let V = [...P, ...Q].sort((a, b) => a-b); // derive: sorted valid
		//let M = r()-1; // combining mark
		let M = !r$1(); // not-whitelisted, check for NSM
		// code currently isn't needed
		/*if (M < 0) { // whitelisted
			M = new Map(read_array_while(() => {
				let i = r();
				if (i) return [V[i-1], read_array_while(() => {
					let v = read_array_while(r);
					if (v.length) return v.map(x => x-1);
				})];
			}));
		}*/
		return {N, P, M, R, V: new Set(V)};
	}
});
const WHOLE_VALID = read_set();
const WHOLE_MAP = new Map();
// decode compressed wholes
[...WHOLE_VALID, ...read_set()].sort((a, b) => a-b).map((cp, i, v) => {
	let d = r$1(); 
	let w = v[i] = d ? v[i-d] : {V: [], M: new Map()};
	w.V.push(cp); // add to member set
	if (!WHOLE_VALID.has(cp)) {
		WHOLE_MAP.set(cp, w);  // register with whole map
	}
});
// compute confusable-extent complements
for (let {V, M} of new Set(WHOLE_MAP.values())) {
	// connect all groups that have each whole character
	let recs = [];
	for (let cp of V) {
		let gs = GROUPS.filter(g => g.V.has(cp));
		let rec = recs.find(({G}) => gs.some(g => G.has(g)));
		if (!rec) {
			rec = {G: new Set(), V: []};
			recs.push(rec);
		}
		rec.V.push(cp);
		gs.forEach(g => rec.G.add(g));
	}
	// per character cache groups which are not a member of the extent
	let union = recs.flatMap(({G}) => [...G]);
	for (let {G, V} of recs) {
		let complement = new Set(union.filter(g => !G.has(g)));
		for (let cp of V) {
			M.set(cp, complement);
		}
	}
}
let union = new Set(); // exists in 1+ groups
let multi = new Set(); // exists in 2+ groups
for (let g of GROUPS) {
	for (let cp of g.V) {
		(union.has(cp) ? multi : union).add(cp);
	}
}
// dual purpose WHOLE_MAP: return placeholder if unique non-confusable
for (let cp of union) {
	if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
		WHOLE_MAP.set(cp, UNIQUE_PH);
	}
}
const VALID = new Set([...union, ...nfd(union)]); // possibly valid

// decode emoji
class Emoji extends Array {
	get is_emoji() { return true; } // free tagging system
}
// 20230719: emoji are now fully-expanded to avoid quirk logic 
const EMOJI_LIST = read_trie(r$1).map(v => Emoji.from(v)).sort(compare_arrays);
const EMOJI_ROOT = new Map(); // this has approx 7K nodes (2+ per emoji)
for (let cps of EMOJI_LIST) {
	// 20230719: change to *slightly* stricter algorithm which disallows 
	// insertion of misplaced FE0F in emoji sequences (matching ENSIP-15)
	// example: beautified [A B] (eg. flag emoji) 
	//  before: allow: [A FE0F B], error: [A FE0F FE0F B] 
	//   after: error: both
	// note: this code now matches ENSNormalize.{cs,java} logic
	let prev = [EMOJI_ROOT];
	for (let cp of cps) {
		let next = prev.map(node => {
			let child = node.get(cp);
			if (!child) {
				// should this be object? 
				// (most have 1-2 items, few have many)
				// 20230719: no, v8 default map is 4?
				child = new Map();
				node.set(cp, child);
			}
			return child;
		});
		if (cp === FE0F) {
			prev.push(...next);
		} else {
			prev = next;
		}
	}
	for (let x of prev) {
		x.V = cps;
	}
}
//console.timeEnd('init');

// create a safe to print string 
// invisibles are escaped
// leading cm uses placeholder
// quoter(cp) => string, eg. 3000 => "{3000}"
// note: in html, you'd call this function then replace [<>&] with entities
function safe_str_from_cps(cps, quoter = quote_cp) {
	//if (Number.isInteger(cps)) cps = [cps];
	//if (!Array.isArray(cps)) throw new TypeError(`expected codepoints`);
	let buf = [];
	if (is_combining_mark(cps[0])) buf.push('◌');
	let prev = 0;
	let n = cps.length;
	for (let i = 0; i < n; i++) {
		let cp = cps[i];
		if (should_escape(cp)) {
			buf.push(str_from_cps(cps.slice(prev, i)));
			buf.push(quoter(cp));
			prev = i + 1;
		}
	}
	buf.push(str_from_cps(cps.slice(prev, n)));
	return buf.join('');
}

// if escaped: {HEX}
//       else: "x" {HEX}
function quoted_cp(cp) {
	return (should_escape(cp) ? '' : `${bidi_qq(safe_str_from_cps([cp]))} `) + quote_cp(cp);
}

// 20230211: some messages can be mixed-directional and result in spillover
// use 200E after a quoted string to force the remainder of a string from 
// acquring the direction of the quote
// https://www.w3.org/International/questions/qa-bidi-unicode-controls#exceptions
function bidi_qq(s) {
	return `"${s}"\u200E`; // strong LTR
}

function check_label_extension(cps) {
	if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
		throw new Error(`invalid label extension: "${str_from_cps(cps.slice(0, 4))}"`);
	}
}
function check_leading_underscore(cps) {
	const UNDERSCORE = 0x5F;
	for (let i = cps.lastIndexOf(UNDERSCORE); i > 0; ) {
		if (cps[--i] !== UNDERSCORE) {
			throw new Error('underscore allowed only at start');
		}
	}
}
// check that a fenced cp is not leading, trailing, or touching another fenced cp
function check_fenced(cps) {
	let cp = cps[0];
	let prev = FENCED.get(cp);
	if (prev) throw error_placement(`leading ${prev}`);
	let n = cps.length;
	let last = -1; // prevents trailing from throwing
	for (let i = 1; i < n; i++) {
		cp = cps[i];
		let match = FENCED.get(cp);
		if (match) {
			// since cps[0] isn't fenced, cps[1] cannot throw
			if (last == i) throw error_placement(`${prev} + ${match}`);
			last = i + 1;
			prev = match;
		}
	}
	if (last == n) throw error_placement(`trailing ${prev}`);
}

// note: set(s) cannot be exposed because they can be modified
function is_combining_mark(cp) {
	return CM.has(cp);
}
function should_escape(cp) {
	return ESCAPE.has(cp);
}

// return all supported emoji as fully-qualified emoji 
// ordered by length then lexicographic 
function ens_emoji() {
	return EMOJI_LIST.map(x => x.slice()); // emoji are exposed so copy
}

function ens_normalize_fragment(frag, decompose) {
	let nf = decompose ? nfd : nfc;
	return frag.split(STOP_CH).map(label => str_from_cps(process(explode_cp(label), nf, filter_fe0f).flat())).join(STOP_CH);
}

function ens_normalize(name) {
	return flatten(split(name, nfc, filter_fe0f));
}

function ens_beautify(name) {
	let labels = split(name, nfc, x => x); // emoji not exposed
	for (let {type, output, error} of labels) {
		if (error) break; // flatten will throw

		// replace leading/trailing hyphen
		// 20230121: consider beautifing all or leading/trailing hyphen to unicode variant
		// not exactly the same in every font, but very similar: "-" vs "‐"
		/*
		const UNICODE_HYPHEN = 0x2010;
		// maybe this should replace all for visual consistancy?
		// `node tools/reg-count.js regex ^-\{2,\}` => 592
		//for (let i = 0; i < output.length; i++) if (output[i] == 0x2D) output[i] = 0x2010;
		if (output[0] == HYPHEN) output[0] = UNICODE_HYPHEN;
		let end = output.length-1;
		if (output[end] == HYPHEN) output[end] = UNICODE_HYPHEN;
		*/
		// 20230123: WHATWG URL uses "CheckHyphens" false
		// https://url.spec.whatwg.org/#idna

		// update ethereum symbol
		// ξ => Ξ if not greek
		if (type !== 'Greek') { 
			let prev = 0;
			while (true) {
				let next = output.indexOf(0x3BE, prev);
				if (next < 0) break;
				output[next] = 0x39E; 
				prev = next + 1;
			}
		}

		// 20221213: fixes bidi subdomain issue, but breaks invariant (200E is disallowed)
		// could be fixed with special case for: 2D (.) + 200E (LTR)
		//output.splice(0, 0, 0x200E);
	}
	return flatten(labels);
}

function ens_split(name, preserve_emoji) {
	return split(name, nfc, preserve_emoji ? x => x.slice() : filter_fe0f); // emoji are exposed so copy
}

function split(name, nf, ef) {
	if (!name) return []; // 20230719: empty name allowance
	let offset = 0;
	// https://unicode.org/reports/tr46/#Validity_Criteria
	// 4.) "The label must not contain a U+002E ( . ) FULL STOP."
	return name.split(STOP_CH).map(label => {
		let input = explode_cp(label);
		let info = {
			input,
			offset, // codepoint, not substring!
		};
		offset += input.length + 1; // + stop
		let norm;
		try {
			// 1.) "The label must be in Unicode Normalization Form NFC"
			let tokens = info.tokens = process(input, nf, ef); // if we parse, we get [norm and mapped]
			let token_count = tokens.length;
			let type;
			if (!token_count) { // the label was effectively empty (could of had ignored characters)
				// 20230120: change to strict
				// https://discuss.ens.domains/t/ens-name-normalization-2nd/14564/59
				//norm = [];
				//type = 'None'; // use this instead of next match, "ASCII"
				throw new Error(`empty label`);
			} else {
				norm = tokens.flat();
				check_leading_underscore(norm);
				let emoji = info.emoji = token_count > 1 || tokens[0].is_emoji;
				if (!emoji && norm.every(cp => cp < 0x80)) { // special case for ascii
					// only needed for ascii
					// 20230123: matches matches WHATWG, see note 3.3
					check_label_extension(norm);
					// cant have fenced
					// cant have cm
					// cant have wholes
					// see derive: "Fastpath ASCII"
					type = 'ASCII';
				} else {
					let chars = tokens.flatMap(x => x.is_emoji ? [] : x); // all of the nfc tokens concat together
					if (!chars.length) { // theres no text, just emoji
						type = 'Emoji';
					} else {
						// 5. "The label must not begin with a combining mark, that is: General_Category=Mark."
						if (CM.has(norm[0])) throw error_placement('leading combining mark');
						for (let i = 1; i < token_count; i++) { // we've already checked the first token
							let cps = tokens[i];
							if (!cps.is_emoji && CM.has(cps[0])) { // every text token has emoji neighbors, eg. EtEEEtEt...
								// bidi_qq() not needed since emoji is LTR and cps is a CM
								throw error_placement(`emoji + combining mark: "${str_from_cps(tokens[i-1])} + ${safe_str_from_cps([cps[0]])}"`); 
							}
						}
						check_fenced(norm);
						let unique = [...new Set(chars)];
						let [g] = determine_group(unique); // take the first match
						// see derive: "Matching Groups have Same CM Style"
						// alternative: could form a hybrid type: Latin/Japanese/...	
						check_group(g, chars); // need text in order
						check_whole(g, unique); // only need unique text (order would be required for multiple-char confusables)
						type = g.N;
						// 20230121: consider exposing restricted flag
						// it's simpler to just check for 'Restricted'
						// or even better: type.endsWith(']')
						//if (g.R) info.restricted = true;
					}
				}
			}
			info.type = type;
		} catch (err) {
			info.error = err; // use full error object
		}
		info.output = norm;
		return info;
	});
}

function check_whole(group, unique) {
	let maker;
	let shared = [];
	for (let cp of unique) {
		let whole = WHOLE_MAP.get(cp);
		if (whole === UNIQUE_PH) return; // unique, non-confusable
		if (whole) {
			let set = whole.M.get(cp); // groups which have a character that look-like this character
			maker = maker ? maker.filter(g => set.has(g)) : [...set];
			if (!maker.length) return; // confusable intersection is empty
		} else {
			shared.push(cp); 
		}
	}
	if (maker) {
		// we have 1+ confusable
		// check if any of the remaning groups
		// contain the shared characters too
		for (let g of maker) {
			if (shared.every(cp => g.V.has(cp))) {
				throw new Error(`whole-script confusable: ${group.N}/${g.N}`);
			}
		}
	}
}

// assumption: unique.size > 0
// returns list of matching groups
function determine_group(unique) {
	let groups = GROUPS;
	for (let cp of unique) {
		// note: we need to dodge CM that are whitelisted
		// but that code isn't currently necessary
		let gs = groups.filter(g => g.V.has(cp));
		if (!gs.length) {
			if (!GROUPS.some(g => g.V.has(cp))) { 
				// 20230716: change to more exact statement, see: ENSNormalize.{cs,java}
				// the character was composed of valid parts
				// but it's NFC form is invalid
				// note: this doesn't have to be a composition
				// 20230720: change to full check
				throw error_disallowed(cp); // this should be rare
			} else {
				// there is no group that contains all these characters
				// throw using the highest priority group that matched
				// https://www.unicode.org/reports/tr39/#mixed_script_confusables
				throw error_group_member(groups[0], cp);
			}
		}
		groups = gs;
		if (gs.length == 1) break; // there is only one group left
	}
	// there are at least 1 group(s) with all of these characters
	return groups;
}

// throw on first error
function flatten(split) {
	return split.map(({input, error, output}) => {
		if (error) {
			// don't print label again if just a single label
			let msg = error.message;
			// bidi_qq() only necessary if msg is digits
			throw new Error(split.length == 1 ? msg : `Invalid label ${bidi_qq(safe_str_from_cps(input))}: ${msg}`); 
		}
		return str_from_cps(output);
	}).join(STOP_CH);
}

function error_disallowed(cp) {
	// TODO: add cp to error?
	return new Error(`disallowed character: ${quoted_cp(cp)}`); 
}
function error_group_member(g, cp) {
	let quoted = quoted_cp(cp);
	let gg = GROUPS.find(g => g.P.has(cp));
	if (gg) {
		quoted = `${gg.N} ${quoted}`;
	}
	return new Error(`illegal mixture: ${g.N} + ${quoted}`);
}
function error_placement(where) {
	return new Error(`illegal placement: ${where}`);
}

// assumption: cps.length > 0
// assumption: cps[0] isn't a CM
// assumption: the previous character isn't an emoji
function check_group(g, cps) {
	let {V, M} = g;
	for (let cp of cps) {
		if (!V.has(cp)) {
			// for whitelisted scripts, this will throw illegal mixture on invalid cm, eg. "e{300}{300}"
			// at the moment, it's unnecessary to introduce an extra error type
			// until there exists a whitelisted multi-character
			//   eg. if (M < 0 && is_combining_mark(cp)) { ... }
			// there are 3 cases:
			//   1. illegal cm for wrong group => mixture error
			//   2. illegal cm for same group => cm error
			//       requires set of whitelist cm per group: 
			//        eg. new Set([...g.V].flatMap(nfc).filter(cp => CM.has(cp)))
			//   3. wrong group => mixture error
			throw error_group_member(g, cp);
		}
	}
	//if (M >= 0) { // we have a known fixed cm count
	if (M) { // we need to check for NSM
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) { // see: assumption
			// 20230210: bugfix: using cps instead of decomposed h/t Carbon225
			/*
			if (CM.has(decomposed[i])) {
				let j = i + 1;
				while (j < e && CM.has(decomposed[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: ${g.N} ${bidi_qq(str_from_cps(decomposed.slice(i-1, j)))} (${j-i}/${M})`);
				}
				i = j;
			}
			*/
			// 20230217: switch to NSM counting
			// https://www.unicode.org/reports/tr39/#Optional_Detection
			if (NSM.has(decomposed[i])) {
				let j = i + 1;
				for (let cp; j < e && NSM.has(cp = decomposed[j]); j++) {
					// a. Forbid sequences of the same nonspacing mark.
					for (let k = i; k < j; k++) { // O(n^2) but n < 100
						if (decomposed[k] == cp) {
							throw new Error(`duplicate non-spacing marks: ${quoted_cp(cp)}`);
						}
					}
				}
				// parse to end so we have full nsm count
				// b. Forbid sequences of more than 4 nonspacing marks (gc=Mn or gc=Me).
				if (j - i > NSM_MAX) {
					// note: this slice starts with a base char or spacing-mark cm
					throw new Error(`excessive non-spacing marks: ${bidi_qq(safe_str_from_cps(decomposed.slice(i-1, j)))} (${j-i}/${NSM_MAX})`);
				}
				i = j;
			}
		}
	}
	// *** this code currently isn't needed ***
	/*
	let cm_whitelist = M instanceof Map;
	for (let i = 0, e = cps.length; i < e; ) {
		let cp = cps[i++];
		let seqs = cm_whitelist && M.get(cp);
		if (seqs) { 
			// list of codepoints that can follow
			// if this exists, this will always be 1+
			let j = i;
			while (j < e && CM.has(cps[j])) j++;
			let cms = cps.slice(i, j);
			let match = seqs.find(seq => !compare_arrays(seq, cms));
			if (!match) throw new Error(`disallowed combining mark sequence: "${safe_str_from_cps([cp, ...cms])}"`);
			i = j;
		} else if (!V.has(cp)) {
			// https://www.unicode.org/reports/tr39/#mixed_script_confusables
			let quoted = quoted_cp(cp);
			for (let cp of cps) {
				let u = UNIQUE.get(cp);
				if (u && u !== g) {
					// if both scripts are restricted this error is confusing
					// because we don't differentiate RestrictedA from RestrictedB 
					if (!u.R) quoted = `${quoted} is ${u.N}`;
					break;
				}
			}
			throw new Error(`disallowed ${g.N} character: ${quoted}`);
			//throw new Error(`disallowed character: ${quoted} (expected ${g.N})`);
			//throw new Error(`${g.N} does not allow: ${quoted}`);
		}
	}
	if (!cm_whitelist) {
		let decomposed = nfd(cps);
		for (let i = 1, e = decomposed.length; i < e; i++) { // we know it can't be cm leading
			if (CM.has(decomposed[i])) {
				let j = i + 1;
				while (j < e && CM.has(decomposed[j])) j++;
				if (j - i > M) {
					throw new Error(`too many combining marks: "${str_from_cps(decomposed.slice(i-1, j))}" (${j-i}/${M})`);
				}
				i = j;
			}
		}
	}
	*/
}

// given a list of codepoints
// returns a list of lists, where emoji are a fully-qualified (as Array subclass)
// eg. explode_cp("abc💩d") => [[61, 62, 63], Emoji[1F4A9, FE0F], [64]]
function process(input, nf, ef) {
	let ret = [];
	let chars = [];
	input = input.slice().reverse(); // flip so we can pop
	while (input.length) {
		let emoji = consume_emoji_reversed(input);
		if (emoji) {
			if (chars.length) {
				ret.push(nf(chars));
				chars = [];
			}
			ret.push(ef(emoji));
		} else {
			let cp = input.pop();
			if (VALID.has(cp)) {
				chars.push(cp);
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					chars.push(...cps);
				} else if (!IGNORED.has(cp)) {
					throw error_disallowed(cp);
				}
			}
		}
	}
	if (chars.length) {
		ret.push(nf(chars));
	}
	return ret;
}

function filter_fe0f(cps) {
	return cps.filter(cp => cp != FE0F);
}

// given array of codepoints
// returns the longest valid emoji sequence (or undefined if no match)
// *MUTATES* the supplied array
// disallows interleaved ignored characters
// fills (optional) eaten array with matched codepoints
function consume_emoji_reversed(cps, eaten) {
	let node = EMOJI_ROOT;
	let emoji;
	let pos = cps.length;
	while (pos) {
		node = node.get(cps[--pos]);
		if (!node) break;
		let {V} = node;
		if (V) { // this is a valid emoji (so far)
			emoji = V;
			if (eaten) eaten.push(...cps.slice(pos).reverse()); // copy input (if needed)
			cps.length = pos; // truncate
		}
	}
	return emoji;
}

// ************************************************************
// tokenizer 

const TY_VALID = 'valid';
const TY_MAPPED = 'mapped';
const TY_IGNORED = 'ignored';
const TY_DISALLOWED = 'disallowed';
const TY_EMOJI = 'emoji';
const TY_NFC = 'nfc';
const TY_STOP = 'stop';

function ens_tokenize(name, {
	nf = true, // collapse unnormalized runs into a single token
} = {}) {
	let input = explode_cp(name).reverse();
	let eaten = [];
	let tokens = [];
	while (input.length) {		
		let emoji = consume_emoji_reversed(input, eaten);
		if (emoji) {
			tokens.push({
				type: TY_EMOJI, 
				emoji: emoji.slice(), // copy emoji
				input: eaten, 
				cps: filter_fe0f(emoji)
			});
			eaten = []; // reset buffer
		} else {
			let cp = input.pop();
			if (cp == STOP) {
				tokens.push({type: TY_STOP, cp});
			} else if (VALID.has(cp)) {
				tokens.push({type: TY_VALID, cps: [cp]});
			} else if (IGNORED.has(cp)) {
				tokens.push({type: TY_IGNORED, cp});
			} else {
				let cps = MAPPED.get(cp);
				if (cps) {
					tokens.push({type: TY_MAPPED, cp, cps: cps.slice()});
				} else {
					tokens.push({type: TY_DISALLOWED, cp});
				}
			}
		}
	}
	if (nf) {
		for (let i = 0, start = -1; i < tokens.length; i++) {
			let token = tokens[i];
			if (is_valid_or_mapped(token.type)) {
				if (requires_check(token.cps)) { // normalization might be needed
					let end = i + 1;
					for (let pos = end; pos < tokens.length; pos++) { // find adjacent text
						let {type, cps} = tokens[pos];
						if (is_valid_or_mapped(type)) {
							if (!requires_check(cps)) break;
							end = pos + 1;
						} else if (type !== TY_IGNORED) { // || type !== TY_DISALLOWED) { 
							break;
						}
					}
					if (start < 0) start = i;
					let slice = tokens.slice(start, end);
					let cps0 = slice.flatMap(x => is_valid_or_mapped(x.type) ? x.cps : []); // strip junk tokens
					let cps = nfc(cps0);
					if (compare_arrays(cps, cps0)) { // bundle into an nfc token
						tokens.splice(start, end - start, {
							type: TY_NFC, 
							input: cps0, // there are 3 states: tokens0 ==(process)=> input ==(nfc)=> tokens/cps
							cps, 
							tokens0: collapse_valid_tokens(slice),
							tokens: ens_tokenize(str_from_cps(cps), {nf: false})
						});
						i = start;
					} else { 
						i = end - 1; // skip to end of slice
					}
					start = -1; // reset
				} else {
					start = i; // remember last
				}
			} else if (token.type !== TY_IGNORED) { // 20221024: is this correct?
				start = -1; // reset
			}
		}
	}
	return collapse_valid_tokens(tokens);
}

function is_valid_or_mapped(type) {
	return type == TY_VALID || type == TY_MAPPED;
}

function requires_check(cps) {
	return cps.some(cp => NFC_CHECK.has(cp));
}

function collapse_valid_tokens(tokens) {
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type == TY_VALID) {
			let j = i + 1;
			while (j < tokens.length && tokens[j].type == TY_VALID) j++;
			tokens.splice(i, j - i, {type: TY_VALID, cps: tokens.slice(i, j).flatMap(x => x.cps)});
		}
	}
	return tokens;
}

exports.ens_beautify = ens_beautify;
exports.ens_emoji = ens_emoji;
exports.ens_normalize = ens_normalize;
exports.ens_normalize_fragment = ens_normalize_fragment;
exports.ens_split = ens_split;
exports.ens_tokenize = ens_tokenize;
exports.is_combining_mark = is_combining_mark;
exports.nfc = nfc;
exports.nfd = nfd;
exports.safe_str_from_cps = safe_str_from_cps;
exports.should_escape = should_escape;
