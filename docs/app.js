var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function set_custom_element_data(node, prop, value) {
        if (prop in node) {
            node[prop] = value;
        }
        else {
            attr(node, prop, value);
        }
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            $$.fragment && $$.fragment.p($$.ctx, $$.dirty);
            $$.dirty = [-1];
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, value = ret) => {
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, detail));
    }
    function append_dev(target, node) {
        dispatch_dev("SvelteDOMInsert", { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev("SvelteDOMInsert", { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev("SvelteDOMRemove", { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ["capture"] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev("SvelteDOMAddEventListener", { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev("SvelteDOMRemoveEventListener", { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev("SvelteDOMRemoveAttribute", { node, attribute });
        else
            dispatch_dev("SvelteDOMSetAttribute", { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.data === data)
            return;
        dispatch_dev("SvelteDOMSetData", { node: text, data });
        text.data = data;
    }
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error(`'target' is a required option`);
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn(`Component was already destroyed`); // eslint-disable-line no-console
            };
        }
    }

    /* src\App.svelte generated by Svelte v3.16.0 */

    const file = "src\\App.svelte";

    function add_css() {
    	var style = element("style");
    	style.id = "svelte-qdf2ku-style";
    	style.textContent = ".app.svelte-qdf2ku{margin:20px;display:grid;grid-template-columns:300px 1fr}.image-thumbnails-wrapper.svelte-qdf2ku{display:grid;grid-template-columns:repeat(auto-fill, minmax(100px, 185px));grid-template-rows:repeat(auto-fill, minmax(100px, 275px));justify-content:center;grid-gap:20px;margin:10px}.image-thumbnails-wrapper.svelte-qdf2ku .image-thumbnail.svelte-qdf2ku{border:1px solid black;border-radius:5px;padding:10px;display:flex;flex-direction:column;align-items:center}.image-thumbnails-wrapper.svelte-qdf2ku .image-thumbnail img.svelte-qdf2ku{width:150px;height:150px}.image-thumbnails-wrapper.svelte-qdf2ku .image-thumbnail p.svelte-qdf2ku{text-align:center;max-width:160px;max-height:20px;overflow:hidden;text-overflow:ellipsis;padding:0 15px}.image-thumbnails-wrapper.svelte-qdf2ku .image-thumbnail zoo-button.svelte-qdf2ku{cursor:pointer;height:45px;display:block}.modal-window.svelte-qdf2ku img.svelte-qdf2ku{max-height:500px;width:100%}.modal-window.svelte-qdf2ku .action-buttons.svelte-qdf2ku{display:flex;margin:10px;gap:10px}.modal-window.svelte-qdf2ku zoo-feedback.svelte-qdf2ku{margin:5px}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXBwLnN2ZWx0ZSIsInNvdXJjZXMiOlsiQXBwLnN2ZWx0ZSJdLCJzb3VyY2VzQ29udGVudCI6WyI8ZGl2IGNsYXNzPVwiYXBwXCI+XHJcblx0PHpvby10b2FzdCBiaW5kOnRoaXM9e19tb2RhbFRvYXN0fT48L3pvby10b2FzdD5cclxuXHQ8ZGl2IGNsYXNzPVwibWVudVwiPlxyXG5cdFx0PGgyPkltYWdlIHZpZXdlcjwvaDI+XHJcblx0XHQ8ZGl2IHN0eWxlPVwid2lkdGg6IDI1MHB4O1wiPlxyXG5cdDwvZGl2PlxyXG5cdFx0PHpvby1pbnB1dCBsYWJlbHRleHQ9XCJDaG9vc2UgaW1hZ2VzIHRvIHVwbG9hZFwiPlxyXG5cdFx0XHQ8aW5wdXQgc2xvdD1cImlucHV0ZWxlbWVudFwiIHR5cGU9XCJmaWxlXCIgbXVsdGlwbGUgYWNjZXB0PVwiLmpwZywgLmpwZWcsIC5wbmdcIiBvbjpjaGFuZ2U9XCJ7ZSA9PiBoYW5kbGVGaWxlVXBsb2FkKGUpfVwiIGJpbmQ6dGhpcz17X2lucHV0fS8+XHJcblx0XHQ8L3pvby1pbnB1dD5cclxuXHQ8L2Rpdj5cclxuXHQ8ZGl2IGNsYXNzPVwiaW1hZ2UtdGh1bWJuYWlscy13cmFwcGVyXCI+XHJcblx0XHR7I2VhY2ggaW1hZ2VzIGFzIGltYWdlLCBpfVxyXG5cdFx0XHQ8ZGl2IGNsYXNzPVwiaW1hZ2UtdGh1bWJuYWlsXCI+XHJcblx0XHRcdFx0PGltZyBzcmM9e2ltYWdlLmRhdGF9IGFsdD1cImltYWdlXCIvPlxyXG5cdFx0XHRcdDxwPntpbWFnZS5uYW1lfTwvcD5cclxuXHRcdFx0XHQ8em9vLWJ1dHRvbiBvbjpjbGljaz1cInsoKSA9PiBvcGVuRGV0YWlsc1ZpZXcoaSl9XCI+XHJcblx0XHRcdFx0XHQ8c3BhbiBzbG90PVwiYnV0dG9uY29udGVudFwiPk9wZW4gZGV0YWlscyB2aWV3PC9zcGFuPlxyXG5cdFx0XHRcdDwvem9vLWJ1dHRvbj5cclxuXHRcdFx0PC9kaXY+XHJcblx0XHR7OmVsc2V9XHJcblx0XHRcdDxwPllvdSBoYXZlbid0IHVwbG9hZGVkIGFueSBpbWFnZXMgeWV0ITwvcD5cclxuXHRcdHsvZWFjaH1cclxuXHQ8L2Rpdj5cclxuXHQ8em9vLW1vZGFsIGJpbmQ6dGhpcz17X21vZGFsfSBjbGFzcz1cIm1vZGFsLXdpbmRvd1wiPlxyXG5cdFx0PGltZyBhbHQ9XCJpbWFnZVwiLz5cclxuXHRcdDx6b28tZmVlZGJhY2sgdHlwZT1cImluZm9cIiBpZD1cInNpemVcIj48L3pvby1mZWVkYmFjaz5cclxuXHRcdDx6b28tZmVlZGJhY2sgdHlwZT1cImluZm9cIiBpZD1cInR5cGVcIj48L3pvby1mZWVkYmFjaz5cclxuXHRcdDx6b28tZmVlZGJhY2sgdHlwZT1cImluZm9cIiBpZD1cImxhc3RNb2RpZmllZFwiPjwvem9vLWZlZWRiYWNrPlxyXG5cdFx0PGRpdiBjbGFzcz1cImFjdGlvbi1idXR0b25zXCI+XHJcblx0XHRcdDxkaXYgY2xhc3M9XCJyZW5hbWVcIj5cclxuXHRcdFx0XHQ8em9vLWlucHV0IGxhYmVsdGV4dD1cIlJlbmFtZSB5b3VyIGZpbGUuXCI+XHJcblx0XHRcdFx0XHQ8aW5wdXQgc2xvdD1cImlucHV0ZWxlbWVudFwiIHR5cGU9XCJ0ZXh0XCIvPlxyXG5cdFx0XHRcdDwvem9vLWlucHV0PlxyXG5cdFx0XHRcdDx6b28tYnV0dG9uIG9uOmNsaWNrPVwieygpID0+IGhhbmRsZVJlbmFtZUJ1dHRvbkNsaWNrKCl9XCI+XHJcblx0XHRcdFx0XHQ8c3BhbiBzbG90PVwiYnV0dG9uY29udGVudFwiPlJlbmFtZSBpbWFnZTwvc3Bhbj5cclxuXHRcdFx0XHQ8L3pvby1idXR0b24+XHJcblx0XHRcdDwvZGl2PlxyXG5cdFx0XHQ8em9vLWJ1dHRvbiB0eXBlPVwiaG90XCIgb246Y2xpY2s9XCJ7KCkgPT4gcmVtb3ZlSW1hZ2UoKX1cIj5cclxuXHRcdFx0XHQ8c3BhbiBzbG90PVwiYnV0dG9uY29udGVudFwiPlJlbW92ZSBpbWFnZTwvc3Bhbj5cclxuXHRcdFx0PC96b28tYnV0dG9uPlxyXG5cdFx0PC9kaXY+XHJcblx0PC96b28tbW9kYWw+XHJcbjwvZGl2PlxyXG5cclxuPHN0eWxlIHR5cGU9XCJ0ZXh0L3Njc3NcIj4uYXBwIHtcbiAgbWFyZ2luOiAyMHB4O1xuICBkaXNwbGF5OiBncmlkO1xuICBncmlkLXRlbXBsYXRlLWNvbHVtbnM6IDMwMHB4IDFmcjsgfVxuXG4uaW1hZ2UtdGh1bWJuYWlscy13cmFwcGVyIHtcbiAgZGlzcGxheTogZ3JpZDtcbiAgZ3JpZC10ZW1wbGF0ZS1jb2x1bW5zOiByZXBlYXQoYXV0by1maWxsLCBtaW5tYXgoMTAwcHgsIDE4NXB4KSk7XG4gIGdyaWQtdGVtcGxhdGUtcm93czogcmVwZWF0KGF1dG8tZmlsbCwgbWlubWF4KDEwMHB4LCAyNzVweCkpO1xuICBqdXN0aWZ5LWNvbnRlbnQ6IGNlbnRlcjtcbiAgZ3JpZC1nYXA6IDIwcHg7XG4gIG1hcmdpbjogMTBweDsgfVxuICAuaW1hZ2UtdGh1bWJuYWlscy13cmFwcGVyIC5pbWFnZS10aHVtYm5haWwge1xuICAgIGJvcmRlcjogMXB4IHNvbGlkIGJsYWNrO1xuICAgIGJvcmRlci1yYWRpdXM6IDVweDtcbiAgICBwYWRkaW5nOiAxMHB4O1xuICAgIGRpc3BsYXk6IGZsZXg7XG4gICAgZmxleC1kaXJlY3Rpb246IGNvbHVtbjtcbiAgICBhbGlnbi1pdGVtczogY2VudGVyOyB9XG4gICAgLmltYWdlLXRodW1ibmFpbHMtd3JhcHBlciAuaW1hZ2UtdGh1bWJuYWlsIGltZyB7XG4gICAgICB3aWR0aDogMTUwcHg7XG4gICAgICBoZWlnaHQ6IDE1MHB4OyB9XG4gICAgLmltYWdlLXRodW1ibmFpbHMtd3JhcHBlciAuaW1hZ2UtdGh1bWJuYWlsIHAge1xuICAgICAgdGV4dC1hbGlnbjogY2VudGVyO1xuICAgICAgbWF4LXdpZHRoOiAxNjBweDtcbiAgICAgIG1heC1oZWlnaHQ6IDIwcHg7XG4gICAgICBvdmVyZmxvdzogaGlkZGVuO1xuICAgICAgdGV4dC1vdmVyZmxvdzogZWxsaXBzaXM7XG4gICAgICBwYWRkaW5nOiAwIDE1cHg7IH1cbiAgICAuaW1hZ2UtdGh1bWJuYWlscy13cmFwcGVyIC5pbWFnZS10aHVtYm5haWwgem9vLWJ1dHRvbiB7XG4gICAgICBjdXJzb3I6IHBvaW50ZXI7XG4gICAgICBoZWlnaHQ6IDQ1cHg7XG4gICAgICBkaXNwbGF5OiBibG9jazsgfVxuXG4ubW9kYWwtd2luZG93IGltZyB7XG4gIG1heC1oZWlnaHQ6IDUwMHB4O1xuICB3aWR0aDogMTAwJTsgfVxuXG4ubW9kYWwtd2luZG93IC5hY3Rpb24tYnV0dG9ucyB7XG4gIGRpc3BsYXk6IGZsZXg7XG4gIG1hcmdpbjogMTBweDtcbiAgZ2FwOiAxMHB4OyB9XG5cbi5tb2RhbC13aW5kb3cgem9vLWZlZWRiYWNrIHtcbiAgbWFyZ2luOiA1cHg7IH1cblxuLyojIHNvdXJjZU1hcHBpbmdVUkw9eC5tYXAgKi88L3N0eWxlPlxyXG5cclxuPHNjcmlwdD5cclxuXHRsZXQgaW1hZ2VzID0gW107XHJcblx0bGV0IF9pbnB1dDtcclxuXHRsZXQgX21vZGFsO1xyXG5cdGxldCBfbW9kYWxUb2FzdDtcclxuXHRsZXQgX21vZGFsSW1nO1xyXG5cdGxldCBfaWR4O1xyXG5cclxuXHRjb25zdCBoYW5kbGVGaWxlVXBsb2FkID0gZSA9PiB7XHJcblx0XHRjb25zdCB0ZW1wID0gWy4uLmltYWdlc107XHJcblx0XHRmb3IgKGxldCBpID0gMDsgaSA8IF9pbnB1dC5maWxlcy5sZW5ndGg7IGkrKykge1xyXG5cdFx0XHRjb25zdCBmaWxlID0gX2lucHV0LmZpbGVzW2ldO1xyXG5cdFx0XHR0ZW1wLnB1c2goe1xyXG5cdFx0XHRcdGRhdGE6IHdpbmRvdy5VUkwuY3JlYXRlT2JqZWN0VVJMKGZpbGUpLFxyXG5cdFx0XHRcdG5hbWU6IGZpbGUubmFtZSxcclxuXHRcdFx0XHRzaXplOiBmaWxlLnNpemUsXHJcblx0XHRcdFx0dHlwZTogZmlsZS50eXBlLFxyXG5cdFx0XHRcdGxhc3RNb2RpZmllZDogZmlsZS5sYXN0TW9kaWZpZWRcclxuXHRcdFx0fSk7XHJcblx0XHR9XHJcblx0XHRpbWFnZXMgPSB0ZW1wO1xyXG5cdFx0X2lucHV0LnZhbHVlID0gbnVsbDtcclxuXHR9XHJcblxyXG5cdGNvbnN0IHJlbW92ZUltYWdlID0gKCkgPT4ge1xyXG5cdFx0aW1hZ2VzID0gaW1hZ2VzLmZpbHRlcigoaW1nLCBpKSA9PiBpICE9PSBfaWR4KTtcclxuXHRcdF9tb2RhbFRvYXN0LnRleHQgPSAnSW1hZ2Ugd2FzIHN1Y2Nlc2Z1bGx5IHJlbW92ZWQhJztcclxuXHRcdF9tb2RhbFRvYXN0LnNob3coKTtcclxuXHRcdF9tb2RhbC5jbG9zZU1vZGFsKCk7XHJcblx0fVxyXG5cclxuXHRjb25zdCBoYW5kbGVSZW5hbWVCdXR0b25DbGljayA9ICgpID0+IHtcclxuXHRcdGltYWdlc1tfaWR4XS5uYW1lID0gX21vZGFsLnF1ZXJ5U2VsZWN0b3IoJ2lucHV0JykudmFsdWU7XHJcblx0XHRfbW9kYWxUb2FzdC50ZXh0ID0gJ0ltYWdlIHdhcyBzdWNjZXNmdWxseSByZW5hbWVkISc7XHJcblx0XHRfbW9kYWxUb2FzdC5zaG93KCk7XHJcblx0XHRfbW9kYWwuY2xvc2VNb2RhbCgpO1xyXG5cdH1cclxuXHJcblx0Y29uc3Qgb3BlbkRldGFpbHNWaWV3ID0gaWR4ID0+IHtcclxuXHRcdF9pZHggPSBpZHg7XHJcblx0XHRjb25zdCBpbWcgPSBpbWFnZXNbX2lkeF07XHJcblx0XHRfbW9kYWwucXVlcnlTZWxlY3RvcignaW1nJykuc3JjID0gaW1nLmRhdGE7XHJcblx0XHRfbW9kYWwucXVlcnlTZWxlY3RvcignaW5wdXQnKS52YWx1ZSA9IGltZy5uYW1lO1xyXG5cdFx0X21vZGFsLnF1ZXJ5U2VsZWN0b3IoJyNzaXplJykudGV4dCA9IGBGaWxlIHNpemU6ICR7aW1nLnNpemV9LmA7XHJcblx0XHRfbW9kYWwucXVlcnlTZWxlY3RvcignI3R5cGUnKS50ZXh0ID0gYEZpbGUgdHlwZTogJHtpbWcudHlwZX0uYDtcclxuXHRcdF9tb2RhbC5xdWVyeVNlbGVjdG9yKCcjbGFzdE1vZGlmaWVkJykudGV4dCA9IGBMYXN0IG1vZGlmaWNhdGlvbiBkYXRlOiAke25ldyBEYXRlKGltZy5sYXN0TW9kaWZpZWQpLnRvSVNPU3RyaW5nKCl9LmA7XHJcblx0XHRfbW9kYWwuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7XHJcblx0fVxyXG48L3NjcmlwdD4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBNEN3QixJQUFJLGNBQUMsQ0FBQyxBQUM1QixNQUFNLENBQUUsSUFBSSxDQUNaLE9BQU8sQ0FBRSxJQUFJLENBQ2IscUJBQXFCLENBQUUsS0FBSyxDQUFDLEdBQUcsQUFBRSxDQUFDLEFBRXJDLHlCQUF5QixjQUFDLENBQUMsQUFDekIsT0FBTyxDQUFFLElBQUksQ0FDYixxQkFBcUIsQ0FBRSxPQUFPLFNBQVMsQ0FBQyxDQUFDLE9BQU8sS0FBSyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FDOUQsa0JBQWtCLENBQUUsT0FBTyxTQUFTLENBQUMsQ0FBQyxPQUFPLEtBQUssQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQzNELGVBQWUsQ0FBRSxNQUFNLENBQ3ZCLFFBQVEsQ0FBRSxJQUFJLENBQ2QsTUFBTSxDQUFFLElBQUksQUFBRSxDQUFDLEFBQ2YsdUNBQXlCLENBQUMsZ0JBQWdCLGNBQUMsQ0FBQyxBQUMxQyxNQUFNLENBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQ3ZCLGFBQWEsQ0FBRSxHQUFHLENBQ2xCLE9BQU8sQ0FBRSxJQUFJLENBQ2IsT0FBTyxDQUFFLElBQUksQ0FDYixjQUFjLENBQUUsTUFBTSxDQUN0QixXQUFXLENBQUUsTUFBTSxBQUFFLENBQUMsQUFDdEIsdUNBQXlCLENBQUMsZ0JBQWdCLENBQUMsR0FBRyxjQUFDLENBQUMsQUFDOUMsS0FBSyxDQUFFLEtBQUssQ0FDWixNQUFNLENBQUUsS0FBSyxBQUFFLENBQUMsQUFDbEIsdUNBQXlCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQyxjQUFDLENBQUMsQUFDNUMsVUFBVSxDQUFFLE1BQU0sQ0FDbEIsU0FBUyxDQUFFLEtBQUssQ0FDaEIsVUFBVSxDQUFFLElBQUksQ0FDaEIsUUFBUSxDQUFFLE1BQU0sQ0FDaEIsYUFBYSxDQUFFLFFBQVEsQ0FDdkIsT0FBTyxDQUFFLENBQUMsQ0FBQyxJQUFJLEFBQUUsQ0FBQyxBQUNwQix1Q0FBeUIsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLGNBQUMsQ0FBQyxBQUNyRCxNQUFNLENBQUUsT0FBTyxDQUNmLE1BQU0sQ0FBRSxJQUFJLENBQ1osT0FBTyxDQUFFLEtBQUssQUFBRSxDQUFDLEFBRXZCLDJCQUFhLENBQUMsR0FBRyxjQUFDLENBQUMsQUFDakIsVUFBVSxDQUFFLEtBQUssQ0FDakIsS0FBSyxDQUFFLElBQUksQUFBRSxDQUFDLEFBRWhCLDJCQUFhLENBQUMsZUFBZSxjQUFDLENBQUMsQUFDN0IsT0FBTyxDQUFFLElBQUksQ0FDYixNQUFNLENBQUUsSUFBSSxDQUNaLEdBQUcsQ0FBRSxJQUFJLEFBQUUsQ0FBQyxBQUVkLDJCQUFhLENBQUMsWUFBWSxjQUFDLENBQUMsQUFDMUIsTUFBTSxDQUFFLEdBQUcsQUFBRSxDQUFDIn0= */";
    	append_dev(document.head, style);
    }

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[17] = list[i];
    	child_ctx[19] = i;
    	return child_ctx;
    }

    // (20:2) {:else}
    function create_else_block(ctx) {
    	let p;

    	const block = {
    		c: function create() {
    			p = element("p");
    			p.textContent = "You haven't uploaded any images yet!";
    			attr_dev(p, "class", "svelte-qdf2ku");
    			add_location(p, file, 20, 3, 699);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, p, anchor);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(p);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(20:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (12:2) {#each images as image, i}
    function create_each_block(ctx) {
    	let div;
    	let img;
    	let img_src_value;
    	let t0;
    	let p;
    	let t1_value = /*image*/ ctx[17].name + "";
    	let t1;
    	let t2;
    	let zoo_button;
    	let span;
    	let t4;
    	let dispose;

    	function click_handler(...args) {
    		return /*click_handler*/ ctx[13](/*i*/ ctx[19], ...args);
    	}

    	const block = {
    		c: function create() {
    			div = element("div");
    			img = element("img");
    			t0 = space();
    			p = element("p");
    			t1 = text(t1_value);
    			t2 = space();
    			zoo_button = element("zoo-button");
    			span = element("span");
    			span.textContent = "Open details view";
    			t4 = space();
    			if (img.src !== (img_src_value = /*image*/ ctx[17].data)) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "image");
    			attr_dev(img, "class", "svelte-qdf2ku");
    			add_location(img, file, 13, 4, 479);
    			attr_dev(p, "class", "svelte-qdf2ku");
    			add_location(p, file, 14, 4, 520);
    			attr_dev(span, "slot", "buttoncontent");
    			add_location(span, file, 16, 5, 602);
    			set_custom_element_data(zoo_button, "class", "svelte-qdf2ku");
    			add_location(zoo_button, file, 15, 4, 545);
    			attr_dev(div, "class", "image-thumbnail svelte-qdf2ku");
    			add_location(div, file, 12, 3, 444);
    			dispose = listen_dev(zoo_button, "click", click_handler, false, false, false);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, img);
    			append_dev(div, t0);
    			append_dev(div, p);
    			append_dev(p, t1);
    			append_dev(div, t2);
    			append_dev(div, zoo_button);
    			append_dev(zoo_button, span);
    			append_dev(div, t4);
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;

    			if (dirty & /*images*/ 1 && img.src !== (img_src_value = /*image*/ ctx[17].data)) {
    				attr_dev(img, "src", img_src_value);
    			}

    			if (dirty & /*images*/ 1 && t1_value !== (t1_value = /*image*/ ctx[17].name + "")) set_data_dev(t1, t1_value);
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(12:2) {#each images as image, i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment(ctx) {
    	let div5;
    	let zoo_toast;
    	let t0;
    	let div1;
    	let h2;
    	let t2;
    	let div0;
    	let t3;
    	let zoo_input0;
    	let input0;
    	let t4;
    	let div2;
    	let t5;
    	let zoo_modal;
    	let img;
    	let t6;
    	let zoo_feedback0;
    	let t7;
    	let zoo_feedback1;
    	let t8;
    	let zoo_feedback2;
    	let t9;
    	let div4;
    	let div3;
    	let zoo_input1;
    	let input1;
    	let t10;
    	let zoo_button0;
    	let span0;
    	let t12;
    	let zoo_button1;
    	let span1;
    	let dispose;
    	let each_value = /*images*/ ctx[0];
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	let each_1_else = null;

    	if (!each_value.length) {
    		each_1_else = create_else_block(ctx);
    		each_1_else.c();
    	}

    	const block = {
    		c: function create() {
    			div5 = element("div");
    			zoo_toast = element("zoo-toast");
    			t0 = space();
    			div1 = element("div");
    			h2 = element("h2");
    			h2.textContent = "Image viewer";
    			t2 = space();
    			div0 = element("div");
    			t3 = space();
    			zoo_input0 = element("zoo-input");
    			input0 = element("input");
    			t4 = space();
    			div2 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t5 = space();
    			zoo_modal = element("zoo-modal");
    			img = element("img");
    			t6 = space();
    			zoo_feedback0 = element("zoo-feedback");
    			t7 = space();
    			zoo_feedback1 = element("zoo-feedback");
    			t8 = space();
    			zoo_feedback2 = element("zoo-feedback");
    			t9 = space();
    			div4 = element("div");
    			div3 = element("div");
    			zoo_input1 = element("zoo-input");
    			input1 = element("input");
    			t10 = space();
    			zoo_button0 = element("zoo-button");
    			span0 = element("span");
    			span0.textContent = "Rename image";
    			t12 = space();
    			zoo_button1 = element("zoo-button");
    			span1 = element("span");
    			span1.textContent = "Remove image";
    			add_location(zoo_toast, file, 1, 1, 20);
    			add_location(h2, file, 3, 2, 92);
    			set_style(div0, "width", "250px");
    			add_location(div0, file, 4, 2, 117);
    			attr_dev(input0, "slot", "inputelement");
    			attr_dev(input0, "type", "file");
    			input0.multiple = true;
    			attr_dev(input0, "accept", ".jpg, .jpeg, .png");
    			add_location(input0, file, 7, 3, 209);
    			set_custom_element_data(zoo_input0, "labeltext", "Choose images to upload");
    			add_location(zoo_input0, file, 6, 2, 157);
    			attr_dev(div1, "class", "menu");
    			add_location(div1, file, 2, 1, 70);
    			attr_dev(div2, "class", "image-thumbnails-wrapper svelte-qdf2ku");
    			add_location(div2, file, 10, 1, 371);
    			attr_dev(img, "alt", "image");
    			attr_dev(img, "class", "svelte-qdf2ku");
    			add_location(img, file, 24, 2, 820);
    			set_custom_element_data(zoo_feedback0, "type", "info");
    			set_custom_element_data(zoo_feedback0, "id", "size");
    			set_custom_element_data(zoo_feedback0, "class", "svelte-qdf2ku");
    			add_location(zoo_feedback0, file, 25, 2, 842);
    			set_custom_element_data(zoo_feedback1, "type", "info");
    			set_custom_element_data(zoo_feedback1, "id", "type");
    			set_custom_element_data(zoo_feedback1, "class", "svelte-qdf2ku");
    			add_location(zoo_feedback1, file, 26, 2, 897);
    			set_custom_element_data(zoo_feedback2, "type", "info");
    			set_custom_element_data(zoo_feedback2, "id", "lastModified");
    			set_custom_element_data(zoo_feedback2, "class", "svelte-qdf2ku");
    			add_location(zoo_feedback2, file, 27, 2, 952);
    			attr_dev(input1, "slot", "inputelement");
    			attr_dev(input1, "type", "text");
    			add_location(input1, file, 31, 5, 1122);
    			set_custom_element_data(zoo_input1, "labeltext", "Rename your file.");
    			add_location(zoo_input1, file, 30, 4, 1074);
    			attr_dev(span0, "slot", "buttoncontent");
    			add_location(span0, file, 34, 5, 1250);
    			add_location(zoo_button0, file, 33, 4, 1186);
    			attr_dev(div3, "class", "rename");
    			add_location(div3, file, 29, 3, 1048);
    			attr_dev(span1, "slot", "buttoncontent");
    			add_location(span1, file, 38, 4, 1393);
    			set_custom_element_data(zoo_button1, "type", "hot");
    			add_location(zoo_button1, file, 37, 3, 1331);
    			attr_dev(div4, "class", "action-buttons svelte-qdf2ku");
    			add_location(div4, file, 28, 2, 1015);
    			set_custom_element_data(zoo_modal, "class", "modal-window svelte-qdf2ku");
    			add_location(zoo_modal, file, 23, 1, 765);
    			attr_dev(div5, "class", "app svelte-qdf2ku");
    			add_location(div5, file, 0, 0, 0);

    			dispose = [
    				listen_dev(input0, "change", /*change_handler*/ ctx[12], false, false, false),
    				listen_dev(zoo_button0, "click", /*click_handler_1*/ ctx[14], false, false, false),
    				listen_dev(zoo_button1, "click", /*click_handler_2*/ ctx[15], false, false, false)
    			];
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div5, anchor);
    			append_dev(div5, zoo_toast);
    			/*zoo_toast_binding*/ ctx[10](zoo_toast);
    			append_dev(div5, t0);
    			append_dev(div5, div1);
    			append_dev(div1, h2);
    			append_dev(div1, t2);
    			append_dev(div1, div0);
    			append_dev(div1, t3);
    			append_dev(div1, zoo_input0);
    			append_dev(zoo_input0, input0);
    			/*input0_binding*/ ctx[11](input0);
    			append_dev(div5, t4);
    			append_dev(div5, div2);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div2, null);
    			}

    			if (each_1_else) {
    				each_1_else.m(div2, null);
    			}

    			append_dev(div5, t5);
    			append_dev(div5, zoo_modal);
    			append_dev(zoo_modal, img);
    			append_dev(zoo_modal, t6);
    			append_dev(zoo_modal, zoo_feedback0);
    			append_dev(zoo_modal, t7);
    			append_dev(zoo_modal, zoo_feedback1);
    			append_dev(zoo_modal, t8);
    			append_dev(zoo_modal, zoo_feedback2);
    			append_dev(zoo_modal, t9);
    			append_dev(zoo_modal, div4);
    			append_dev(div4, div3);
    			append_dev(div3, zoo_input1);
    			append_dev(zoo_input1, input1);
    			append_dev(div3, t10);
    			append_dev(div3, zoo_button0);
    			append_dev(zoo_button0, span0);
    			append_dev(div4, t12);
    			append_dev(div4, zoo_button1);
    			append_dev(zoo_button1, span1);
    			/*zoo_modal_binding*/ ctx[16](zoo_modal);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*openDetailsView, images*/ 129) {
    				each_value = /*images*/ ctx[0];
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(div2, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (each_value.length) {
    				if (each_1_else) {
    					each_1_else.d(1);
    					each_1_else = null;
    				}
    			} else if (!each_1_else) {
    				each_1_else = create_else_block(ctx);
    				each_1_else.c();
    				each_1_else.m(div2, null);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div5);
    			/*zoo_toast_binding*/ ctx[10](null);
    			/*input0_binding*/ ctx[11](null);
    			destroy_each(each_blocks, detaching);
    			if (each_1_else) each_1_else.d();
    			/*zoo_modal_binding*/ ctx[16](null);
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let images = [];
    	let _input;
    	let _modal;
    	let _modalToast;
    	let _modalImg;
    	let _idx;

    	const handleFileUpload = e => {
    		const temp = [...images];

    		for (let i = 0; i < _input.files.length; i++) {
    			const file = _input.files[i];

    			temp.push({
    				data: window.URL.createObjectURL(file),
    				name: file.name,
    				size: file.size,
    				type: file.type,
    				lastModified: file.lastModified
    			});
    		}

    		$$invalidate(0, images = temp);
    		$$invalidate(1, _input.value = null, _input);
    	};

    	const removeImage = () => {
    		$$invalidate(0, images = images.filter((img, i) => i !== _idx));
    		$$invalidate(3, _modalToast.text = "Image was succesfully removed!", _modalToast);
    		_modalToast.show();
    		_modal.closeModal();
    	};

    	const handleRenameButtonClick = () => {
    		$$invalidate(0, images[_idx].name = _modal.querySelector("input").value, images);
    		$$invalidate(3, _modalToast.text = "Image was succesfully renamed!", _modalToast);
    		_modalToast.show();
    		_modal.closeModal();
    	};

    	const openDetailsView = idx => {
    		_idx = idx;
    		const img = images[_idx];
    		_modal.querySelector("img").src = img.data;
    		_modal.querySelector("input").value = img.name;
    		_modal.querySelector("#size").text = `File size: ${img.size}.`;
    		_modal.querySelector("#type").text = `File type: ${img.type}.`;
    		_modal.querySelector("#lastModified").text = `Last modification date: ${new Date(img.lastModified).toISOString()}.`;
    		$$invalidate(2, _modal.style.display = "block", _modal);
    	};

    	function zoo_toast_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(3, _modalToast = $$value);
    		});
    	}

    	function input0_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(1, _input = $$value);
    		});
    	}

    	const change_handler = e => handleFileUpload();
    	const click_handler = i => openDetailsView(i);
    	const click_handler_1 = () => handleRenameButtonClick();
    	const click_handler_2 = () => removeImage();

    	function zoo_modal_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(2, _modal = $$value);
    		});
    	}

    	$$self.$capture_state = () => {
    		return {};
    	};

    	$$self.$inject_state = $$props => {
    		if ("images" in $$props) $$invalidate(0, images = $$props.images);
    		if ("_input" in $$props) $$invalidate(1, _input = $$props._input);
    		if ("_modal" in $$props) $$invalidate(2, _modal = $$props._modal);
    		if ("_modalToast" in $$props) $$invalidate(3, _modalToast = $$props._modalToast);
    		if ("_modalImg" in $$props) _modalImg = $$props._modalImg;
    		if ("_idx" in $$props) _idx = $$props._idx;
    	};

    	return [
    		images,
    		_input,
    		_modal,
    		_modalToast,
    		handleFileUpload,
    		removeImage,
    		handleRenameButtonClick,
    		openDetailsView,
    		_idx,
    		_modalImg,
    		zoo_toast_binding,
    		input0_binding,
    		change_handler,
    		click_handler,
    		click_handler_1,
    		click_handler_2,
    		zoo_modal_binding
    	];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		if (!document.getElementById("svelte-qdf2ku-style")) add_css();
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
    	target: document.body
    });

    return app;

}());
