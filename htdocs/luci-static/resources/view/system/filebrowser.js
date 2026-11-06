'use strict';
'require view';
'require rpc';
'require ui';

/*
 * luci-app-filebrowser - 25.12 port (JS view)
 *
 * Frontend for the `luci.filebrowser` rpcd/ucode backend.
 * Feature set mirrors the original Lua app by DarkDean89/giaulo:
 * browse, open/download, upload, rename, delete, symlink following,
 * back/forward history support.
 */

const callList = rpc.declare({
	object: 'luci.filebrowser',
	method: 'list',
	params: ['path']
});

const callRemove = rpc.declare({
	object: 'luci.filebrowser',
	method: 'remove',
	params: ['path']
});

const callRename = rpc.declare({
	object: 'luci.filebrowser',
	method: 'rename',
	params: ['path', 'newpath']
});

const callMkdir = rpc.declare({
	object: 'luci.filebrowser',
	method: 'mkdir',
	params: ['path']
});

const callRead = rpc.declare({
	object: 'luci.filebrowser',
	method: 'read',
	params: ['path']
});

const callWrite = rpc.declare({
	object: 'luci.filebrowser',
	method: 'write',
	params: ['path', 'data']
});

function fmtSize(n) {
	if (n == null) return '-';
	const units = ['B', 'K', 'M', 'G', 'T'];
	let i = 0, v = n;
	while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
	return (i === 0 ? v : v.toFixed(1)) + units[i];
}

function fmtTime(ts) {
	if (!ts) return '-';
	const d = new Date(ts * 1000);
	const p = (x) => String(x).padStart(2, '0');
	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
		' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function fmtMode(mode) {
	if (mode == null) return '-';
	/* stat mode includes file-type bits; keep the low 9 permission bits */
	const perms = mode & 0o777;
	const chars = 'rwxrwxrwx';
	let s = '';
	for (let i = 0; i < 9; i++)
		s += (perms & (1 << (8 - i))) ? chars[i] : '-';
	return s;
}

function b64ToBlob(b64, mime) {
	const bin = atob(b64);
	const chunks = [];
	for (let off = 0; off < bin.length; off += 32768) {
		const slice = bin.slice(off, off + 32768);
		const bytes = new Uint8Array(slice.length);
		for (let i = 0; i < slice.length; i++)
			bytes[i] = slice.charCodeAt(i);
		chunks.push(bytes);
	}
	return new Blob(chunks, { type: mime || 'application/octet-stream' });
}

return view.extend({
	currentPath: '/',

	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function () {
		let init = '/';
		const m = /[?&]path=([^&]+)/.exec(window.location.search);
		if (m) {
			try { init = decodeURIComponent(m[1]); } catch (e) { /* keep '/' */ }
		}
		this.currentPath = init;
		return callList(init);
	},

	joinPath: function (dir, name) {
		return (dir === '/') ? '/' + name : dir.replace(/\/$/, '') + '/' + name;
	},

	parentPath: function (path) {
		if (path === '/') return null;
		const p = path.replace(/\/[^/]+\/?$/, '');
		return p === '' ? '/' : p;
	},

	render: function (data) {
		const self = this;

		const pathInput = E('input', {
			'id': 'fb-path',
			'type': 'text',
			'class': 'cbi-input-text',
			'style': 'flex:1;min-width:200px',
			'value': this.currentPath
		});

		const statusLine = E('div', { 'id': 'fb-status', 'style': 'margin:.5em 0;color:#c00' });
		const listBox = E('div', { 'id': 'fb-list' });

		const fileInput = E('input', {
			'type': 'file',
			'style': 'display:none'
		});

		function setStatus(msg) {
			statusLine.textContent = msg || '';
		}

		function navigate(path, push) {
			return callList(path).then(function (res) {
				if (res && res.error) {
					setStatus(res.error);
					return;
				}
				self.currentPath = res.path;
				pathInput.value = res.path;
				setStatus('');
				renderList(res);
				if (push !== false)
					history.pushState({ path: res.path }, null, '?path=' + encodeURIComponent(res.path));
			}).catch(function (err) {
				setStatus(_('Request failed') + ': ' + err);
			});
		}

		function refresh() {
			return navigate(self.currentPath, false);
		}

		function download(abspath) {
			setStatus(_('Loading…'));
			callRead(abspath).then(function (res) {
				setStatus('');
				if (res && res.error) {
					ui.addNotification(null, E('p', res.error), 'error');
					return;
				}
				const blob = b64ToBlob(res.data, res.mime);
				const url = URL.createObjectURL(blob);
				const a = E('a', { 'href': url, 'download': res.name });
				document.body.appendChild(a);
				a.click();
				a.remove();
				setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
			}).catch(function (err) {
				setStatus(_('Request failed') + ': ' + err);
			});
		}

		function doDelete(entry) {
			const full = self.joinPath(self.currentPath, entry.name);
			if (!confirm(_('Confirm deletion of %s ?').format(full)))
				return;
			callRemove(full).then(function (res) {
				if (res && res.error)
					ui.addNotification(null, E('p', res.error), 'error');
				else
					refresh();
			});
		}

		function doRename(entry) {
			const name = prompt(_('Enter a new name:'), entry.name);
			if (name == null) return;
			const trimmed = name.trim();
			if (!trimmed || trimmed === entry.name) return;
			if (trimmed.indexOf('/') >= 0) {
				ui.addNotification(null, E('p', _('Name must not contain /')), 'error');
				return;
			}
			callRename(self.joinPath(self.currentPath, entry.name),
				self.joinPath(self.currentPath, trimmed)).then(function (res) {
				if (res && res.error)
					ui.addNotification(null, E('p', res.error), 'error');
				else
					refresh();
			});
		}

		function renderList(res) {
			const table = E('table', { 'class': 'table' });
			table.appendChild(E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th left' }, _('Name')),
				E('th', { 'class': 'th left' }, _('Modified')),
				E('th', { 'class': 'th left' }, _('Size')),
				E('th', { 'class': 'th left' }, _('Permissions')),
				E('th', { 'class': 'th right' }, _('Actions'))
			]));

			if (res.path !== '/') {
				table.appendChild(E('tr', {
					'class': 'tr', 'style': 'cursor:pointer',
					'click': function () { navigate(self.parentPath(res.path)); }
				}, [
					E('td', { 'class': 'td left', 'colspan': '5' }, [E('strong', '📁 ..')])
				]));
			}

			(res.entries || []).forEach(function (entry) {
				const isDir = entry.type === 'dir' ||
					(entry.type === 'link' && entry.link_type === 'dir');
				const icon = entry.type === 'link' ? '🔗' : (entry.type === 'dir' ? '📁' : '📄');
				let display = entry.name;
				if (entry.type === 'link')
					display += ' → ' + (entry.link_target || '');

				const nameCell = E('td', { 'class': 'td left' }, [icon + ' ' + display]);
				const row = E('tr', { 'class': 'tr' }, [
					nameCell,
					E('td', { 'class': 'td left' }, fmtTime(entry.mtime)),
					E('td', { 'class': 'td left' }, isDir ? '-' : fmtSize(entry.size)),
					E('td', { 'class': 'td left' }, fmtMode(entry.mode)),
					E('td', { 'class': 'td right' }, [
						E('button', {
							'class': 'cbi-button cbi-button-edit',
							'click': function (ev) { ev.stopPropagation(); doRename(entry); }
						}, _('Rename')),
						' ',
						E('button', {
							'class': 'cbi-button cbi-button-remove',
							'click': function (ev) { ev.stopPropagation(); doDelete(entry); }
						}, _('Delete'))
					])
				]);

				nameCell.style.cursor = 'pointer';
				nameCell.addEventListener('click', function () {
					if (entry.type === 'dir') {
						navigate(self.joinPath(res.path, entry.name));
					}
					else if (entry.type === 'link') {
						if (entry.link_type === 'dir')
							navigate(entry.link_abspath);
						else if (entry.link_type === 'file')
							download(entry.link_abspath);
						else
							ui.addNotification(null, E('p', _('Broken symbolic link')), 'warning');
					}
					else {
						download(self.joinPath(res.path, entry.name));
					}
				});

				table.appendChild(row);
			});

			listBox.innerHTML = '';
			listBox.appendChild(table);
		}

		pathInput.addEventListener('keyup', function (ev) {
			if (ev.key === 'Enter') navigate(pathInput.value.trim());
		});
		pathInput.addEventListener('blur', function () {
			if (pathInput.value.trim() !== self.currentPath)
				navigate(pathInput.value.trim());
		});

		fileInput.addEventListener('change', function () {
			const file = fileInput.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = function () {
				const b64 = String(reader.result).split(',')[1] || '';
				const target = self.joinPath(self.currentPath, file.name);
				callWrite(target, b64).then(function (res) {
					if (res && res.error)
						ui.addNotification(null, E('p', res.error), 'error');
					else
						refresh();
					fileInput.value = '';
				});
			};
			reader.onerror = function () {
				ui.addNotification(null, E('p', _('Failed to read local file')), 'error');
				fileInput.value = '';
			};
			reader.readAsDataURL(file);
		});

		window.addEventListener('popstate', function (ev) {
			const path = (ev.state && ev.state.path) || '/';
			navigate(path, false);
		});

		const page = E('div', {}, [
			E('h2', { 'name': 'content' }, _('Document Management')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'style': 'display:flex;gap:.5em;align-items:center;flex-wrap:wrap' }, [
					pathInput,
					E('button', {
						'class': 'cbi-button',
						'click': function () { navigate(pathInput.value.trim()); }
					}, _('Go')),
					E('button', {
						'class': 'cbi-button',
						'click': function () { refresh(); }
					}, _('Refresh')),
					E('button', {
						'class': 'cbi-button cbi-button-apply',
						'click': function () { fileInput.click(); }
					}, _('Upload')),
					E('button', {
						'class': 'cbi-button',
						'click': function () {
							const name = prompt(_('Enter folder name:'));
							if (name == null) return;
							const trimmed = name.trim();
							if (!trimmed || trimmed.indexOf('/') >= 0) return;
							callMkdir(self.joinPath(self.currentPath, trimmed)).then(function (res) {
								if (res && res.error)
									ui.addNotification(null, E('p', res.error), 'error');
								else
									refresh();
							});
						}
					}, _('New Folder'))
				]),
				fileInput,
				statusLine,
				listBox
			])
		]);

		if (data && data.error)
			setStatus(data.error);
		else if (data)
			renderList(data);

		return page;
	}
});
